import type {
  CharRange,
  DFA,
  DFAEdgeGroup,
  DFATransition,
  NFA,
  SubsetStep,
} from '../../../shared/types';
import { buildSignature } from './alphabet';
import { labelAccepts } from './labels';
import { normalizeRanges } from './ranges';

/**
 * 子集构造（NFA → DFA）。
 *
 * 核心两步反复执行：
 *   ε-closure(T)：从集合 T 出发只沿 ε 边能到达的全部状态；
 *   move(T, a)  ：从集合 T 出发沿字符 a 能一步到达的全部状态。
 * DFA 的每个状态 = 一个 NFA 状态集合。BFS 去重，直到没有新集合出现。
 *
 * 为了不必枚举整个 Unicode，先用各标签断点把字符空间切成“同行为区域”，
 * 每个区域只取一个代表码点参与构造。
 *
 * 输出里保留每一步（闭包 / 注册新状态 / 迁移 / 完成），
 * 以及随步骤增长的“子集对照表”。
 */

interface InternalState {
  id: number;
  subset: number[]; // 排序后的 NFA 状态集合
  accept: boolean;
  dead: boolean;
}

interface InternalTransition {
  from: number;
  to: number;
  repCode: number; // 该迁移使用的区域代表码点
}

export interface SubsetResult {
  dfa: DFA;
  steps: SubsetStep[];
  sigRanges: CharRange[];
}

export class SubsetBuilder {
  private readonly nfa: NFA;
  private readonly adj: Map<
    number,
    { to: number; label: NFA['transitions'][number]['label'] }[]
  >;
  private readonly reps: number[];
  private readonly sigRanges: CharRange[];

  private states: InternalState[] = [];
  private transitions: InternalTransition[] = [];
  private steps: SubsetStep[] = [];
  private keyToId = new Map<string, number>();

  constructor(nfa: NFA) {
    this.nfa = nfa;
    this.adj = new Map();
    for (const s of nfa.states) this.adj.set(s.id, []);
    for (const t of nfa.transitions) {
      this.adj.get(t.from)!.push({ to: t.to, label: t.label });
    }
    const sig = buildSignature(nfa.transitions.map((t) => t.label));
    this.reps = sig.reps;
    this.sigRanges = sig.ranges;
  }

  run(): SubsetResult {
    // 起始 DFA 状态 = 初始 NFA 状态的 ε-闭包
    const startSet = this.epsilonClosure([this.nfa.startId]);
    const start = this.registerState(startSet);
    this.pushStep({
      kind: 'closure',
      description: `从 NFA 初始状态 n${this.nfa.startId} 求 ε-闭包，得到起始 DFA 状态 q${start.id} = ${formatSubset(startSet)}${
        start.accept ? '，其中含接受态，故 q0 也是接受态' : ''
      }`,
      subset: startSet,
      newState: start.id,
    });

    // BFS：每取出一个 DFA 状态，就对每个字符区域求一次迁移
    let head = 0;
    while (head < this.states.length) {
      const cur = this.states[head++];
      if (cur.dead) continue; // 死状态自环最后统一补，不产生教学步骤

      for (const code of this.reps) {
        const moved = this.move(cur.subset, code);
        const closure = this.epsilonClosure(moved);

        const existed = this.keyToId.get(keyOf(closure));
        let targetId: number;
        let created: InternalState | null = null;
        if (existed === undefined) {
          created = this.registerState(closure);
          targetId = created.id;
        } else {
          targetId = existed;
        }

        this.transitions.push({ from: cur.id, to: targetId, repCode: code });

        if (created) {
          this.pushStep({
            kind: 'state',
            description: `从 q${cur.id} 沿 ${formatCode(code)} 求 move 再闭包得到 ${formatSubset(
              closure,
            )}，它第一次出现，注册为 q${created.id}${
              created.accept ? '（含 NFA 接受态，标记为接受态）' : ''
            }，并记下转移 q${cur.id} ─${formatCode(code)}→ q${created.id}`,
            currentState: cur.id,
            charCode: code,
            subset: closure,
            newState: created.id,
          });
        } else {
          this.pushStep({
            kind: 'move',
            description: `从 q${cur.id} 沿 ${formatCode(code)} 得到 ${formatSubset(
              closure,
            )}，对应已存在的 q${targetId}，记下转移 q${cur.id} ─${formatCode(code)}→ q${targetId}`,
            currentState: cur.id,
            charCode: code,
            subset: closure,
          });
        }
      }
    }

    this.completeDeadState();

    const dfa = this.makeDfa();
    this.steps.push({
      index: this.steps.length,
      kind: 'dead',
      description: '子集构造完成：每个 DFA 状态都是一组 NFA 状态，对每个字符都有唯一确定的转移。',
      dfa,
      subset: [],
      table: this.table(),
    });

    return { dfa, steps: this.steps, sigRanges: this.sigRanges };
  }

  /** 沿 ε 边求闭包 */
  private epsilonClosure(seeds: number[]): number[] {
    const seen = new Set<number>(seeds);
    const stack = [...seeds];
    while (stack.length) {
      const s = stack.pop()!;
      for (const edge of this.adj.get(s) ?? []) {
        if (edge.label.kind === 'eps' && !seen.has(edge.to)) {
          seen.add(edge.to);
          stack.push(edge.to);
        }
      }
    }
    return [...seen].sort((a, b) => a - b);
  }

  /** 从集合 T 沿字符 a 走一步（不含 ε） */
  private move(subset: number[], code: number): number[] {
    const out = new Set<number>();
    for (const s of subset) {
      for (const edge of this.adj.get(s) ?? []) {
        if (edge.label.kind === 'set' && labelAccepts(edge.label, code)) {
          out.add(edge.to);
        }
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  private registerState(subset: number[]): InternalState {
    const id = this.states.length;
    const state: InternalState = {
      id,
      subset,
      accept: subset.includes(this.nfa.acceptId),
      dead: subset.length === 0,
    };
    this.states.push(state);
    this.keyToId.set(keyOf(subset), id);
    return state;
  }

  /** 死状态对所有区域自环，保证 DFA 是完整转移表 */
  private completeDeadState(): void {
    const dead = this.states.find((s) => s.dead);
    if (!dead) return;
    for (const code of this.reps) {
      this.transitions.push({ from: dead.id, to: dead.id, repCode: code });
    }
  }

  private pushStep(partial: Omit<SubsetStep, 'index' | 'dfa' | 'table'>): void {
    this.steps.push({
      index: this.steps.length,
      dfa: this.makeDfa(),
      table: this.table(),
      ...partial,
    });
  }

  private table(): SubsetStep['table'] {
    return this.states.map((s) => ({
      stateId: s.id,
      subset: s.subset,
      accept: s.accept,
    }));
  }

  /** 由内部状态/迁移生成对外 DFA：区域展开成区间边并按目标合并 */
  private makeDfa(): DFA {
    const deadState = this.states.find((s) => s.dead);

    const states = this.states.map((s) => ({
      id: s.id,
      subset: s.subset,
      accept: s.accept,
      ...(s.dead ? { dead: true as const } : {}),
    }));

    const byPair = new Map<string, { from: number; to: number; ranges: CharRange[] }>();
    const rawTransitions: DFATransition[] = [];
    let tid = 0;
    for (const t of this.transitions) {
      const region = this.sigRanges[this.reps.indexOf(t.repCode)];
      rawTransitions.push({ id: tid++, from: t.from, to: t.to, charCode: t.repCode });
      const gk = `${t.from}->${t.to}`;
      let g = byPair.get(gk);
      if (!g) {
        g = { from: t.from, to: t.to, ranges: [] };
        byPair.set(gk, g);
      }
      g.ranges.push(region);
    }

    const edges: DFAEdgeGroup[] = [];
    const deadEdges: DFAEdgeGroup[] = [];
    for (const g of byPair.values()) {
      const group: DFAEdgeGroup = {
        id: `${g.from}-${g.to}`,
        from: g.from,
        to: g.to,
        // 同一目标的相邻区域合并，标签天然压成连续区间
        ranges: normalizeRanges(g.ranges),
      };
      if (deadState && g.to === deadState.id) deadEdges.push(group);
      else edges.push(group);
    }
    edges.sort((a, b) => a.from - b.from || a.to - b.to);
    deadEdges.sort((a, b) => a.from - b.from);

    return {
      states,
      transitions: rawTransitions,
      edges,
      deadEdges,
      startId: 0,
      acceptIds: this.states.filter((s) => s.accept).map((s) => s.id),
      alphabet: [...this.reps].sort((a, b) => a - b),
      regions: this.sigRanges,
    };
  }
}

function keyOf(subset: number[]): string {
  return subset.join(',');
}

function formatSubset(subset: number[]): string {
  if (subset.length === 0) return '∅（空集）';
  return `{${subset.map((s) => `n${s}`).join(', ')}}`;
}

export function formatCode(code: number): string {
  if (code === 9) return "'\\t'";
  if (code === 10) return "'\\n'";
  if (code === 13) return "'\\r'";
  if (code === 32) return "' '";
  const ch = String.fromCodePoint(code);
  return /^[ -~]$/.test(ch) ? `'${ch}'` : `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function subsetConstruct(nfa: NFA): SubsetResult {
  return new SubsetBuilder(nfa).run();
}
