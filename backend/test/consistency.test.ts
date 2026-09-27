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
