import type {
  CharRange,
  DFA,
  DFASimResult,
  DFASimStep,
  MinDFA,
  NFA,
  NFASimResult,
  NFASimStep,
} from '../../../shared/types';
import { inRanges } from './ranges';

/**
 * 测试串模拟。三台机器各跑一遍同一条输入：
 *  - NFA：ε-NFA 的“活动集合”式模拟（天然的并行非确定模拟）；
 *  - DFA / 最小化 DFA：查完整转移表单步推进。
 * 路径上访问的边和状态一并返回，供前端逐字符高亮。
 */

/* ---------------- NFA ---------------- */

interface NFAEdge {
  id: number;
  from: number;
  to: number;
  label: NFA['transitions'][number]['label'];
}

export function simulateNFA(nfa: NFA, input: string): NFASimResult {
  const adj = new Map<number, NFAEdge[]>();
  for (const s of nfa.states) adj.set(s.id, []);
  for (const t of nfa.transitions) adj.get(t.from)!.push(t);

  const closureFrom = (seeds: number[]): { set: Set<number>; epsUsed: number[] } => {
    const set = new Set<number>(seeds);
    const epsUsed: number[] = [];
    const stack = [...seeds];
    while (stack.length) {
      const s = stack.pop()!;
      for (const e of adj.get(s) ?? []) {
        if (e.label.kind === 'eps' && !set.has(e.to)) {
          set.add(e.to);
          epsUsed.push(e.id);
          stack.push(e.to);
        }
      }
    }
    return { set, epsUsed };
  };

  const steps: NFASimStep[] = [];

  let { set: active, epsUsed } = closureFrom([nfa.startId]);
  const acceptedAt = (set: Set<number>) => set.has(nfa.acceptId);
  steps.push({
    pos: 0,
    activeStates: [...setSorted(active)],
    epsilonEdges: epsUsed,
    symbolEdges: [],
    prefixAccepted: acceptedAt(active),
  });

  let pos = 0;
  for (const ch of input) {
    pos++;
    const code = ch.codePointAt(0)!;

    // 消费字符：从所有活动状态并发地走标签匹配的边
    const symbolEdges: number[] = [];
    const seeds = new Set<number>();
    for (const s of active) {
      for (const e of adj.get(s) ?? []) {
        if (e.label.kind === 'set' && labelHas(e.label.ranges, e.label.negated, code)) {
          symbolEdges.push(e.id);
          seeds.add(e.to);
        }
      }
    }

    const next = closureFrom([...seeds]);
    active = next.set;

    steps.push({
      pos,
      activeStates: [...setSorted(active)],
      epsilonEdges: next.epsUsed,
      symbolEdges,
      char: ch,
      charCode: code,
      prefixAccepted: acceptedAt(active),
    });
  }

  return { kind: 'nfa', steps, accepted: acceptedAt(active) };
}

/* ---------------- DFA（也用于最小化 DFA） ---------------- */

function regionIndexOf(regions: CharRange[], code: number): number {
  // regions 互不相交且按 lo 升序，二分
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = regions[mid];
    if (code < r.lo) hi = mid - 1;
    else if (code > r.hi) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function simulateDFA(automaton: DFA | MinDFA, input: string, kind: 'dfa' | 'min'): DFASimResult {
  const steps: DFASimStep[] = [];
  const delta = new Map<string, number>();
  for (const t of automaton.transitions) {
    delta.set(`${t.from}|${t.charCode}`, t.to);
  }
  const edgeIdOf = (from: number, to: number) => `${from}-${to}`;

  let state = automaton.startId;
  steps.push({
    pos: 0,
    stateId: state,
    edgeId: null,
    ...(kind === 'min'
      ? { memberStates: (automaton as MinDFA).states.find((s) => s.id === state)?.members ?? [] }
      : {}),
  });

  let pos = 0;
  for (const ch of input) {
    pos++;
    const code = ch.codePointAt(0)!;
    const ri = regionIndexOf(automaton.regions, code);
    const rep = ri >= 0 ? automaton.alphabet[ri] : undefined;
    const next = rep === undefined ? undefined : delta.get(`${state}|${rep}`);

    if (next === undefined) {
      // 完整 DFA 不应发生；防御性地停在原地并标记无路可走
      steps.push({ pos, stateId: state, edgeId: null, char: ch, charCode: code });
      continue;
    }
    steps.push({
      pos,
      stateId: next,
      edgeId: edgeIdOf(state, next),
      char: ch,
      charCode: code,
      ...(kind === 'min'
        ? { memberStates: (automaton as MinDFA).states.find((s) => s.id === next)?.members ?? [] }
        : {}),
    });
    state = next;
  }

  const accepted = automaton.acceptIds.includes(state);
  return { kind, steps, accepted };
}

/* ---------------- 小工具 ---------------- */

function labelHas(ranges: { lo: number; hi: number }[], negated: boolean, code: number): boolean {
  const hit = inRanges(ranges as CharRange[], code);
  return negated ? !hit : hit;
}

function setSorted<T extends number>(s: Set<T>): number[] {
  return [...s].sort((a, b) => a - b);
}
