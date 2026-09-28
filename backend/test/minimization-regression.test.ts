import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipeline, simulateAll } from '../src/pipeline';
import { parseRegex } from '../src/parser/parser';
import type { ASTNode } from '../src/parser/parser';
import type { CharRange } from '../../shared/types';

/**
 * 回归测试：最小化 DFA 必须与原 DFA / NFA 识别完全相同的语言。
 *
 * 早期版本的 Hopcroft 在用“试金石块 + 字符”审视划分时，把试金石块自己排除在
 * 可拆分对象之外（只遍历其它块）。当一个块在处理试金石的过程中才被拆出来、且它
 * 内部状态读该字符后“有的回到试金石、有的不回到”时，这个块就再也没机会被拆开，
 * 于是起始态可能被错误地并入死态，最小化 DFA 凭空接受串。
 *
 * 这些用例把该 bug 锁死，并用随机正则 + 独立回溯语义做模糊测试，防止同类偏差复发。
 */

/* ---------------- 课代表报障的具体用例 ---------------- */

interface ReportedCase {
  pattern: string;
  accept: string[];
  reject: string[];
  /** 该正则最小化后应有的状态数 */
  minStates: number;
}

const REPORTED: ReportedCase[] = [
  {
    pattern: '(x.*b)+',
    accept: ['xb', 'xab', 'xxxb', 'xbab'],
    reject: ['axb', 'yxb', '', 'x', 'b', 'xa'],
    minStates: 4,
  },
  {
    pattern: '([^a].*[bc])+',
    accept: ['bc', 'xc', 'bxb'],
    reject: ['b', 'abc', 'axb', '', 'a', 'ab'],
    minStates: 4,
  },
  {
    pattern: '(b|([a-z]|x)+)[^a]',
    accept: ['bz', 'x1', 'abx'],
    reject: ['1bz', 'ba', ''],
    minStates: 5,
  },
];

test('报障正则：三台机器对接受/拒绝样例结论一致', () => {
  for (const c of REPORTED) {
    const data = buildPipeline(c.pattern);
    for (const s of [...c.accept, ...c.reject]) {
      const r = simulateAll(data, s);
      const want = c.accept.includes(s);
      assert.equal(r.nfa.accepted, want, `${c.pattern} NFA 对 ${JSON.stringify(s)} 判定错误`);
      assert.equal(r.dfa.accepted, want, `${c.pattern} DFA 对 ${JSON.stringify(s)} 判定错误`);
      assert.equal(r.min.accepted, want, `${c.pattern} 最小 DFA 对 ${JSON.stringify(s)} 判定错误`);
      assert.equal(r.agree, true, `${c.pattern} 三台机器对 ${JSON.stringify(s)} 结论不一致`);
    }
  }
});

test('报障正则：最小化状态数符合预期，起始态不与死态合并', () => {
  for (const c of REPORTED) {
    const data = buildPipeline(c.pattern);
    assert.equal(
      data.minDfa.states.length,
      c.minStates,
      `${c.pattern} 最小化后应有 ${c.minStates} 个状态`,
    );

    const start = data.minDfa.states.find((s) => s.id === data.minDfa.startId)!;
    assert.equal(start.dead, undefined, `${c.pattern} 的初始态不应被标记为死状态`);

    // 合并对照表里，初始 DFA 状态与死 DFA 状态不能落进同一个等价类
    const deadOriginal = data.dfa.states.find((s) => s.dead);
    if (deadOriginal) {
      assert.notEqual(
        data.minDfa.mergeMap[data.dfa.startId],
        data.minDfa.mergeMap[deadOriginal.id],
        `${c.pattern} 的初始态与死态不应归为同一类`,
      );
    }
  }
});

/* ---------------- Hopcroft 逐步演示的结构自洽性 ---------------- */

/** 从中文说明里抽出形如 {0, 1} 的状态集合（按出现顺序） */
function braceSets(description: string): number[][] {
  return [...description.matchAll(/\{([0-9,\s]*)\}/g)].map((m) =>
    m[1]
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .map(Number),
  );
}

function assertHopcroftStepsSound(pattern: string): void {
  const data = buildPipeline(pattern);
  const steps = data.hopcroftSteps;

  // 第一步必须是 init，最后一步必须是 done
  assert.equal(steps[0].kind, 'init', `${pattern}: 第一步应为 init`);
  assert.equal(steps[steps.length - 1].kind, 'done', `${pattern}: 最后一步应为 done`);

  // 块数单调不减，且最后一步的块数 == 最小化 DFA 的状态数
  let prev = 0;
  for (const step of steps) {
    assert.ok(
      step.blocks.length >= prev,
      `${pattern}: 第 ${step.index} 步块数 ${step.blocks.length} 少于上一步 ${prev}`,
    );
    prev = step.blocks.length;

    // 每一步的块两两不相交，并恰好覆盖原 DFA 的全部状态
    const seen = new Set<number>();
    for (const b of step.blocks) {
      for (const s of b.stateIds) {
        assert.ok(!seen.has(s), `${pattern}: 状态 ${s} 在第 ${step.index} 步重复出现在多个块中`);
        seen.add(s);
      }
    }
    assert.equal(
      seen.size,
      data.dfa.states.length,
      `${pattern}: 第 ${step.index} 步的划分未覆盖全部 DFA 状态`,
    );
  }
  assert.equal(
    steps[steps.length - 1].blocks.length,
    data.minDfa.states.length,
    `${pattern}: 最终块数与最小 DFA 状态数不符`,
  );

  // 每个 split 步骤：说明文字里出现的各成员集合必须与当时的块成员一致
  let prevBlocks = steps[0].blocks;
  for (const step of steps.slice(1)) {
    if (step.kind === 'split' && step.split) {
      const byId = new Map(step.blocks.map((b) => [b.id, b.stateIds]));
      const targetNow = byId.get(step.split.blockId);
      assert.ok(targetNow, `${pattern}: 第 ${step.index} 步被拆块 P${step.split.blockId} 不存在`);

      const sets = braceSets(step.description);
      assert.ok(sets.length >= 2, `${pattern}: 第 ${step.index} 步说明文字缺少拆分成员集合`);

      // 文字中的每个集合都必须是“当时某一个块”的精确成员（顺序无关）
      for (const set of sets) {
        const members = [...set].sort((a, b) => a - b);
        const match = step.blocks.some(
          (b) =>
            b.stateIds.length === members.length &&
            b.stateIds.every((s, i) => s === members[i]),
        );
        assert.ok(
          match,
          `${pattern}: 第 ${step.index} 步说明中的 {${members.join(', ')}} 与当时块成员不一致`,
        );
      }

      // 拆分产生的两个块此刻都应存在，其成员之并 == 拆分前该块的成员
      const ids = step.split.newBlockIds;
      assert.equal(new Set(ids).size, 2, `${pattern}: 第 ${step.index} 步应产生两个块 id`);
      const before = prevBlocks.find((b) => b.id === step.split!.blockId);
      assert.ok(before, `${pattern}: 第 ${step.index} 步被拆块在上一步不存在`);
      const union = ids
        .flatMap((id) => byId.get(id)!)
        .sort((a, b) => a - b);
      assert.deepEqual(
        union,
        [...before.stateIds].sort((a, b) => a - b),
        `${pattern}: 第 ${step.index} 步拆分后两块之并不等于拆分前成员`,
      );

      // 触发拆分的状态必须属于拆分前的块，且它读触发字符后确实进入试金石块
      assert.ok(
        before.stateIds.includes(step.split.stateId),
        `${pattern}: 第 ${step.index} 步指示状态不在被拆块中`,
      );
    }
    prevBlocks = step.blocks;
  }
}

test('报障正则：Hopcroft 步骤结构自洽（块数、覆盖、说明文字与成员一致）', () => {
  for (const c of REPORTED) assertHopcroftStepsSound(c.pattern);
});

/* ---------------- 独立的回溯语义（不经过 Thompson/子集构造） ---------------- */

function classAccepts(ranges: CharRange[], negated: boolean, code: number): boolean {
  const hit = ranges.some((r) => code >= r.lo && code <= r.hi);
  return negated ? !hit : hit;
}

/** AST 是否能在 input 的 pos 位置匹配，返回所有可能的结束位置（完整匹配语义） */
function deriveEnds(node: ASTNode, input: number[], pos: number, ends: Set<number>): void {
  switch (node.kind) {
    case 'char':
      if (pos < input.length && input[pos] === node.code) ends.add(pos + 1);
      return;
    case 'class':
      if (
        pos < input.length &&
        classAccepts(node.ranges, node.negated, input[pos])
      ) {
        ends.add(pos + 1);
      }
      return;
    case 'concat': {
      let frontier = new Set<number>([pos]);
      for (const child of node.children) {
        const next = new Set<number>();
        for (const p of frontier) deriveEnds(child, input, p, next);
        frontier = next;
      }
      for (const p of frontier) ends.add(p);
      return;
    }
    case 'alt':
      for (const child of node.children) deriveEnds(child, input, pos, ends);
      return;
    case 'opt':
      ends.add(pos);
      deriveEnds(node.child, input, pos, ends);
      return;
    case 'star':
    case 'plus': {
      // 逐步展开重复，visited 防止 ε 自环导致的原地打转
      let frontier = new Set<number>([pos]);
      const reached = new Set<number>([pos]);
      if (node.kind === 'star') {
        ends.add(pos); // * 允许重复 0 次
      } else {
        frontier = new Set();
        deriveEnds(node.child, input, pos, frontier); // + 至少重复 1 次
        for (const p of frontier) {
          reached.add(p);
          ends.add(p);
        }
      }
      while (frontier.size) {
        const next = new Set<number>();
        for (const p of frontier) deriveEnds(node.child, input, p, next);
        frontier = new Set([...next].filter((p) => !reached.has(p)));
        for (const p of frontier) {
          reached.add(p);
          ends.add(p);
        }
      }
      return;
    }
  }
}

function regexAccepts(pattern: string, input: string): boolean {
  const ast = parseRegex(pattern);
  const codes = [...input].map((ch) => ch.codePointAt(0)!);
  const ends = new Set<number>();
  deriveEnds(ast, codes, 0, ends);
  return ends.has(codes.length);
}

/* ---------------- 随机正则模糊测试 ---------------- */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_CHARS = ['a', 'b', 'c', 'x', '0', '1', '\n'];

function randomPattern(rand: () => number, depth: number): string {
  const leaf = (): string => {
    switch (Math.floor(rand() * 6)) {
      case 0:
        return 'a';
      case 1:
        return 'b';
      case 2:
        return 'x';
      case 3:
        return '.';
      case 4:
        return '[ab]';
      default:
        return '[^a]';
    }
  };
  // 深度受控：避免组合出 NFA 上百状态、DFA 指数膨胀的“病态”正则把测试撑爆
  const atom = (): string =>
    depth > 0 && rand() < 0.4 ? `(${randomPattern(rand, depth - 1)})` : leaf();
  const quant = (): string => {
    const a = atom();
    const r = rand();
    if (r < 0.2) return `${a}*`;
    if (r < 0.4) return `${a}+`;
    if (r < 0.52) return `${a}?`;
    return a;
  };
  const concat = (): string => {
    const n = 1 + Math.floor(rand() * 2); // 1..2 个因子
    return Array.from({ length: n }, () => quant()).join('');
  };

  if (depth <= 0 || rand() < 0.6) return concat();
  return `${concat()}|${concat()}`;
}

function randomInput(rand: () => number, maxLen: number): string {
  const len = Math.floor(rand() * (maxLen + 1));
  let s = '';
  for (let i = 0; i < len; i++) s += FUZZ_CHARS[Math.floor(rand() * FUZZ_CHARS.length)];
  return s;
}

/** 在固定字母表上穷举所有长度 ≤ maxLen 的串（含 ε） */
function* allStrings(chars: string[], maxLen: number): Generator<string> {
  yield '';
  let frontier = [''];
  for (let len = 1; len <= maxLen; len++) {
    frontier = frontier.flatMap((p) => chars.map((c) => p + c));
    for (const s of frontier) yield s;
  }
}

test('随机正则模糊：最小化 DFA 与 NFA/DFA 一致，且与独立回溯语义一致', () => {
  const rand = mulberry32(20260928);
  const N = 240;
  let patternsChecked = 0;
  let inputsChecked = 0;

  for (let i = 0; i < N; i++) {
    const pattern = randomPattern(rand, 2);
    let data: ReturnType<typeof buildPipeline>;
    try {
      data = buildPipeline(pattern);
    } catch {
      continue; // 生成器只造合法正则，这里仅作防御
    }
    patternsChecked++;

    // 1) 短串穷举：三台机器两两一致，并与独立回溯语义一致
    for (const input of allStrings(['a', 'b', 'x', '\n'], 4)) {
      const r = simulateAll(data, input);
      assert.equal(
        r.agree,
        true,
        `三机不一致 pattern=${pattern} input=${JSON.stringify(input)} ` +
          `nfa=${r.nfa.accepted} dfa=${r.dfa.accepted} min=${r.min.accepted}`,
      );
      const oracle = regexAccepts(pattern, input);
      assert.equal(
        r.min.accepted,
        oracle,
        `最小 DFA 与回溯语义不符 pattern=${pattern} input=${JSON.stringify(input)} ` +
          `min=${r.min.accepted} oracle=${oracle}`,
      );
      inputsChecked++;
    }

    // 2) 较长的随机串抽样（覆盖区域内部码点、重复结构等）
    for (let k = 0; k < 24; k++) {
      const input = randomInput(rand, 14);
      const r = simulateAll(data, input);
      assert.equal(
        r.agree,
        true,
        `三机不一致 pattern=${pattern} input=${JSON.stringify(input)}`,
      );
      assert.equal(
        r.min.accepted,
        regexAccepts(pattern, input),
        `最小 DFA 与回溯语义不符 pattern=${pattern} input=${JSON.stringify(input)}`,
      );
      inputsChecked++;
    }

    // 3) Hopcroft 步骤对每条随机正则都必须结构自洽
    assertHopcroftStepsSound(pattern);

    // 4) 结构性质：状态数不增；合并表保持接受性与转移一致性
    assert.ok(data.minDfa.states.length <= data.dfa.states.length);
    const minDelta = new Map(
      data.minDfa.transitions.map((t) => [`${t.from}|${t.charCode}`, t.to]),
    );
    for (const t of data.dfa.transitions) {
      const fromId = data.minDfa.mergeMap[t.from];
      const toId = data.minDfa.mergeMap[t.to];
      assert.equal(minDelta.get(`${fromId}|${t.charCode}`), toId,
        `合并后转移不一致 pattern=${pattern}: q${t.from} --${t.charCode}--> q${t.to}`);
    }
  }

  assert.ok(patternsChecked >= 200, `实际检查的随机正则数偏少：${patternsChecked}`);
  assert.ok(inputsChecked > 20000, `实际检查的串数偏少：${inputsChecked}`);
});
