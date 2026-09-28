import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipeline, simulateAll } from '../src/pipeline';
import { EXAMPLES } from '../src/examples';

/** 简单的确定性伪随机，保证测试可复现 */
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

const PATTERNS = [
  'a',
  'ab',
  'a|b',
  'a*',
  'a+',
  'a?',
  '(a|b)*abb',
  '(ab|a)(ba)*',
  '[a-z]+@[a-z]+',
  '[0-9]+(\\.[0-9]+)?',
  '"([^"]|\\\\")*"',
  '(0|1(01*0)*1)*',
  ...EXAMPLES.map((e) => e.pattern),
];

/** 模糊测试：随机串在三台机器上的判定必须完全一致 —— 本项目的核心正确性主线 */
test('NFA / DFA / 最小化 DFA 对随机测试串判定一致（fuzz）', () => {
  const rand = mulberry32(20260926);
  const pools = [
    ['a', 'b'],
    ['a', 'b', 'c'],
    ['0', '1'],
    ['0', '1', '.', '9'],
    ['a', 'z', '@', '0', '_'],
    ['"', '\\', 'a', 'n', ' '],
    Array.from({ length: 95 }, (_, i) => String.fromCodePoint(33 + i)),
  ];

  let checked = 0;
  for (const pattern of PATTERNS) {
    const data = buildPipeline(pattern);
    for (const pool of pools) {
      for (let i = 0; i < 200; i++) {
        const len = Math.floor(rand() * 8);
        let input = '';
        for (let j = 0; j < len; j++) input += pool[Math.floor(rand() * pool.length)];
        const r = simulateAll(data, input);
        assert.equal(
          r.agree,
          true,
          `不一致！pattern=${pattern} input=${JSON.stringify(input)} nfa=${r.nfa.accepted} dfa=${r.dfa.accepted} min=${r.min.accepted}`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `实际检查条数偏少：${checked}`);
});

test('内置示例的接受/拒绝样例在三台机器上全部给出预期结果', () => {
  for (const ex of EXAMPLES) {
    const data = buildPipeline(ex.pattern);
    for (const s of ex.acceptSamples) {
      const r = simulateAll(data, s);
      assert.equal(r.nfa.accepted, true, `${ex.name}: NFA 应接受 ${JSON.stringify(s)}`);
      assert.equal(r.dfa.accepted, true, `${ex.name}: DFA 应接受 ${JSON.stringify(s)}`);
      assert.equal(r.min.accepted, true, `${ex.name}: 最小 DFA 应接受 ${JSON.stringify(s)}`);
    }
    const rj = simulateAll(data, ex.rejectSample);
    assert.equal(rj.nfa.accepted, false, `${ex.name}: NFA 应拒绝 ${JSON.stringify(ex.rejectSample)}`);
    assert.equal(rj.dfa.accepted, false, `${ex.name}: DFA 应拒绝`);
    assert.equal(rj.min.accepted, false, `${ex.name}: 最小 DFA 应拒绝`);
  }
});

test('最小化 DFA 的状态数不超过原 DFA，且起始/接受信息保留', () => {
  for (const pattern of PATTERNS) {
    const d = buildPipeline(pattern);
    assert.ok(d.minDfa.states.length <= d.dfa.states.length);
    assert.equal(d.minDfa.startId === undefined, false);
    const minAccept = new Set(d.minDfa.acceptIds);
    for (const oldState of d.dfa.states) {
      const newId = d.minDfa.mergeMap[oldState.id];
      assert.notEqual(newId, undefined, `原状态 ${oldState.id} 必须出现在合并表中`);
      assert.equal(minAccept.has(newId), oldState.accept, '合并前后接受性必须一致');
    }
  }
});

test('Hopcroft 划分步骤：块数单调不减，最终块数 = 最小 DFA 状态数', () => {
  const d = buildPipeline('(a|b)*abb');
  let prev = 0;
  for (const step of d.hopcroftSteps) {
    assert.ok(step.blocks.length >= prev);
    prev = step.blocks.length;
  }
  const finalStep = d.hopcroftSteps[d.hopcroftSteps.length - 1];
  assert.equal(finalStep.blocks.length, d.minDfa.states.length);
});

test('空串输入：三台机器结论一致（可空语言应接受 ε）', () => {
  const acceptsEps = buildPipeline('a*');
  const r1 = simulateAll(acceptsEps, '');
  assert.equal(r1.nfa.accepted, true);
  assert.equal(r1.dfa.accepted, true);
  assert.equal(r1.min.accepted, true);

  const rejectsEps = buildPipeline('a+');
  const r2 = simulateAll(rejectsEps, '');
  assert.equal(r2.nfa.accepted, false);
  assert.equal(r2.dfa.accepted, false);
  assert.equal(r2.min.accepted, false);
});

test('DFA 与最小化 DFA 对字符区域代表点之外的真实码点同样一致', () => {
  // 字符类包含区间时，区域内部任意码点行为必须相同
  const d = buildPipeline('[a-z]+');
  for (const input of ['a', 'm', 'zzz', 'A', '0', 'a1']) {
    const r = simulateAll(d, input);
    assert.equal(r.agree, true);
  }
});

/* ---------------- 回归用例：最小化时误并初始态与死状态 ---------------- */

/** 课堂上抓到的一组反例及其关键测试串 */
const REGRESSION_CASES: { pattern: string; accepts: string[]; rejects: string[] }[] = [
  {
    pattern: '(x.*b)+',
    accepts: ['xb', 'xab'],
    rejects: ['axb', 'yxb'],
  },
  {
    pattern: '([^a].*[bc])+',
    accepts: ['bb', 'xc', 'xbc'],
    rejects: ['abc', 'axb'],
  },
  {
    pattern: '(b|([a-z]|x)+)[^a]',
    accepts: ['b0', 'az1'],
    rejects: ['1bz'],
  },
];

for (const { pattern, accepts, rejects } of REGRESSION_CASES) {
  test(`回归：${pattern} 三台机器对关键串结论一致`, () => {
    const d = buildPipeline(pattern);
    for (const input of [...accepts, ...rejects]) {
      const r = simulateAll(d, input);
      assert.equal(r.agree, true, `${pattern} vs ${JSON.stringify(input)} 结论不一致`);
    }
    for (const input of accepts) {
      assert.equal(simulateAll(d, input).min.accepted, true, `${pattern} 应接受 ${JSON.stringify(input)}`);
    }
    for (const input of rejects) {
      assert.equal(simulateAll(d, input).min.accepted, false, `${pattern} 应拒绝 ${JSON.stringify(input)}`);
    }
  });
}

test('回归：(x.*b)+ 最小化后为 4 个状态，初始态不再与死状态同类', () => {
  const d = buildPipeline('(x.*b)+');
  assert.equal(d.minDfa.states.length, 4);
  assert.equal(d.dfa.states.length, 6);

  const startMin = d.minDfa.mergeMap[d.dfa.startId];
  const deadOld = d.dfa.states.find((s) => s.dead)!;
  assert.notEqual(deadOld, undefined);
  assert.notEqual(d.minDfa.mergeMap[deadOld.id], startMin, '初始态不得与死状态合并');

  const startState = d.minDfa.states.find((s) => s.id === startMin)!;
  assert.equal(startState.dead, undefined, '初始态不应被标记为死状态');
  assert.equal(startState.accept, false);
});

test('回归：这几条正则的最小化结果本身确实最小（任意两块可区分）', () => {
  for (const { pattern } of REGRESSION_CASES) {
    const d = buildPipeline(pattern);
    const finalStep = d.hopcroftSteps[d.hopcroftSteps.length - 1];
    assert.equal(
      finalStep.blocks.length,
      d.minDfa.states.length,
      `${pattern}: 最终块数必须等于最小 DFA 状态数`,
    );
    const blockOf = new Map<number, number>();
    for (const b of finalStep.blocks) for (const id of b.stateIds) blockOf.set(id, b.id);
    const delta = new Map<string, number>();
    for (const t of d.dfa.transitions) delta.set(`${t.from}|${t.charCode}`, t.to);
    const blocks = finalStep.blocks;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        // 同接受性的两块必须至少在一个字符上走向不同的块
        if (blocks[i].accepting !== blocks[j].accepting) continue;
        const distinguishable = d.dfa.alphabet.some(
          (c) =>
            blockOf.get(delta.get(`${blocks[i].stateIds[0]}|${c}`)!) !==
            blockOf.get(delta.get(`${blocks[j].stateIds[0]}|${c}`)!),
        );
        assert.equal(distinguishable, true, `${pattern}: P${blocks[i].id} 与 P${blocks[j].id} 不可区分，说明还没最小化`);
      }
    }
  }
});

/* ---------------- 随机正则模糊测试 ---------------- */

/**
 * 随机生成语法受限但行为多样的正则：
 * 原子含普通字符、字符类（含取反，专门制造“宽区域 + 死状态”的情形）、
 * 通配符 . 与括号分组；可叠加 * + ? 与连接、选择。
 */
function makeRegexGenerator(rand: () => number) {
  const atoms = ['a', 'b', 'c', 'x', 'y', '.', '[ab]', '[^a]', '[b-c]', '[a-cx]', '[xyz]'];
  const quants = ['', '', '*', '+', '?'];

  function atom(): string {
    let s = atoms[Math.floor(rand() * atoms.length)];
    s += quants[Math.floor(rand() * quants.length)];
    // 少量情况下把原子包成分组后再加量词，制造嵌套的 + 组（bug 的高发结构）
    if (rand() < 0.2) {
      const inner = atoms[Math.floor(rand() * atoms.length)];
      const q = ['*', '+', '?'][Math.floor(rand() * 3)];
      s = `(${inner})${q}`;
    }
    return s;
  }

  function generate(depth: number): string {
    if (depth <= 0) return atom();
    const parts: string[] = [];
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) parts.push(rand() < 0.35 ? `(${generate(depth - 1)})` : atom());
    let expr = parts.join('');
    if (rand() < 0.3) {
      expr = `${expr}|${generate(depth - 1)}`;
    }
    if (rand() < 0.25) expr = `(${expr})${['*', '+', '?'][Math.floor(rand() * 3)]}`;
    return expr;
  }

  return () => generate(1 + Math.floor(rand() * 3));
}

test('随机生成的正则：NFA / DFA / 最小化 DFA 对随机串判定一致（random-regex fuzz）', () => {
  const rand = mulberry32(20260928);
  const nextPattern = makeRegexGenerator(rand);
  const pools = [
    ['a', 'b'],
    ['a', 'b', 'c'],
    ['a', 'x', 'y', 'b', 'c', '0', 'z'],
    Array.from({ length: 26 }, (_, i) => String.fromCodePoint(97 + i)),
    ['a', 'b', 'c', 'x', 'y', ' ', '0', 'A', '\n', '-'],
  ];

  let patternsChecked = 0;
  let inputsChecked = 0;
  for (let n = 0; n < 220; n++) {
    const pattern = nextPattern();
    let data;
    try {
      data = buildPipeline(pattern);
    } catch {
      continue; // 个别随机串可能触发教学上限等约束，跳过即可
    }
    patternsChecked++;

    // 结构不变量：最终划分块数 = 最小 DFA 状态数，初始态不与死状态错误合并
    const finalStep = data.hopcroftSteps[data.hopcroftSteps.length - 1];
    assert.equal(
      finalStep.blocks.length,
      data.minDfa.states.length,
      `${pattern}: 最终划分块数 ${finalStep.blocks.length} 与最小 DFA 状态数 ${data.minDfa.states.length} 不符`,
    );
    const deadOld = data.dfa.states.find((s) => s.dead);
    if (deadOld && !data.dfa.states[data.dfa.startId].dead) {
      assert.notEqual(
        data.minDfa.mergeMap[deadOld.id],
        data.minDfa.mergeMap[data.dfa.startId],
        `${pattern}: 初始态被并入了死状态`,
      );
    }

    for (let k = 0; k < 60; k++) {
      const pool = pools[Math.floor(rand() * pools.length)];
      const len = Math.floor(rand() * 7);
      let input = '';
      for (let i = 0; i < len; i++) input += pool[Math.floor(rand() * pool.length)];
      const r = simulateAll(data, input);
      assert.equal(
        r.agree,
        true,
        `随机正则不一致！pattern=${pattern} input=${JSON.stringify(input)} nfa=${r.nfa.accepted} dfa=${r.dfa.accepted} min=${r.min.accepted}`,
      );
      inputsChecked++;
    }
  }
  assert.ok(patternsChecked >= 100, `随机正则数量偏少：${patternsChecked}`);
  assert.ok(inputsChecked > 3000, `随机串数量偏少：${inputsChecked}`);
});
