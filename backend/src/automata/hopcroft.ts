import type {
  CharRange,
  DFA,
  DFAEdgeGroup,
  DFATransition,
  HopcroftStep,
  MinDFA,
  MinDFAState,
} from '../../../shared/types';
import { normalizeRanges } from './ranges';

/**
 * Hopcroft 划分细化（DFA → 最小化 DFA）。
 *
 * 从最粗的划分开始：接受态一块、非接受态一块（“在终点上是否可区分”）。
 * 不断取一块 B 和一个字符 c 当“试金石”：
 *   若某块 X 中，一部分状态读 c 后进入 B、另一部分不进入 B，
 *   则 X 里的这两部分状态可被区分，必须拆成两块。
 * 没有任何块还能拆时，同一块内的状态两两等价，合并即得最小 DFA。
 *
 * 块 id 在整个过程中保持稳定（拆分后较大的一块沿用旧 id），
 * 前端可以用固定颜色跟踪每个等价类。
 */

interface Block {
  id: number;
  members: Set<number>;
  accepting: boolean;
}

export interface HopcroftResult {
  minDfa: MinDFA;
  steps: HopcroftStep[];
}

export class HopcroftMinimizer {
  private blocks: Block[] = [];
  private blockSeq = 0;
  private blockOf = new Map<number, number>();
  private worklist = new Set<number>();
  private steps: HopcroftStep[] = [];

  private readonly reps: number[];
  private readonly regions: CharRange[];
  private readonly delta: Map<string, number>;

  constructor(private readonly dfa: DFA) {
    this.reps = dfa.alphabet;
    this.regions = dfa.regions;
    this.delta = new Map();
    for (const t of dfa.transitions) {
      this.delta.set(`${t.from}|${t.charCode}`, t.to);
    }
  }

  run(): HopcroftResult {
    this.initPartition();

    this.steps.push({
      index: 0,
      kind: 'init',
      description:
        '初始划分（最粗的可区分标准）：接受态一块、非接受态一块。不同块的状态在“是否接受”上已经可区分。',
      blocks: this.snapshotBlocks(),
    });

    while (this.worklist.size > 0) {
      const splitterId = this.pickWorklistBlock();
      this.worklist.delete(splitterId);
      const splitter = this.blocks.find((b) => b.id === splitterId)!;

      for (const c of this.reps) {
        // 每换一个字符都重新审视当前所有块（拆分产生的新块也要被检查）。
        // 注意试金石块自身也必须在候选中：pre_c(B) 同样可以把 B 自己切开
        // （例如“死状态对 c 自环、同块另一状态对 c 走出本块”的情形），
        // 跳过它会导致本可区分的状态被错误合并。
        for (const x of this.blocks) {
          const into: number[] = [];
          const out: number[] = [];
          for (const s of x.members) {
            const dest = this.delta.get(`${s}|${c}`);
            if (dest !== undefined && this.blockOf.get(dest) === splitter.id) into.push(s);
            else out.push(s);
          }
          if (into.length === 0 || out.length === 0) continue;

          this.splitBlock(x, into, out, splitter.id, c);
        }
      }
    }

    this.steps.push({
      index: this.steps.length,
      kind: 'done',
      description:
        '没有任何块还能继续拆分：同一块内的状态读任意字符都走向同一块、且同为接受/非接受，彼此等价。把每块合并成一个状态，即得到最小 DFA。',
      blocks: this.snapshotBlocks(),
    });

    return { minDfa: this.buildMinDfa(), steps: this.steps };
  }

  private initPartition(): void {
    const nonAcc: number[] = [];
    const acc: number[] = [];
    for (const s of this.dfa.states) {
      (s.accept ? acc : nonAcc).push(s.id);
    }
    if (nonAcc.length) this.addBlock(nonAcc, false, true);
    if (acc.length) this.addBlock(acc, true, true);
  }

  private addBlock(members: number[], accepting: boolean, seed: boolean): Block {
    const block: Block = {
      id: this.blockSeq++,
      members: new Set(members),
      accepting,
    };
    this.blocks.push(block);
    for (const m of members) this.blockOf.set(m, block.id);
    if (seed) this.worklist.add(block.id);
    return block;
  }

  /** 确定性地选工作集中编号最小的块当试金石 */
  private pickWorklistBlock(): number {
    let min = Infinity;
    for (const id of this.worklist) if (id < min) min = id;
    return min;
  }

  private splitBlock(x: Block, into: number[], out: number[], splitterId: number, c: number): void {
    into.sort((a, b) => a - b);
    out.sort((a, b) => a - b);

    // 较大的一半沿用旧块 id（颜色稳定），较小的一半领新 id
    const keepOldPart = out.length >= into.length ? out : into;
    const newPart = keepOldPart === out ? into : out;
    const newBlock = this.addBlock(newPart, x.accepting, false);

    x.members = new Set(keepOldPart);
    for (const m of keepOldPart) this.blockOf.set(m, x.id);

    // 工作集更新：X 已在集中 → 两块都入集；否则把较小的一块放进去就够
    if (this.worklist.has(x.id)) {
      this.worklist.add(newBlock.id);
    } else {
      const smaller = newPart.length <= keepOldPart.length ? newBlock.id : x.id;
      this.worklist.add(smaller);
    }

    const pivotState = into[0];
    this.steps.push({
      index: this.steps.length,
      kind: 'split',
      description:
        `试金石：块 P${splitterId} + 字符 ${fmtCode(c)}。块 P${x.id} 因此分裂 —— ` +
        `{${into.join(', ')}} 读 ${fmtCode(c)} 后进入 P${splitterId}，{${out.join(', ')}} 不进入；` +
        `分成 P${x.id}（{${keepOldPart.join(', ')}}）与 P${newBlock.id}（{${newPart.join(', ')}}）。`,
      blocks: this.snapshotBlocks(),
      pivotState,
      pivotChar: c,
      split: {
        blockId: x.id,
        newBlockIds: [x.id, newBlock.id],
        stateId: pivotState,
        charCode: c,
      },
    });
  }

  private snapshotBlocks(): HopcroftStep['blocks'] {
    return this.blocks
      .map((b) => ({
        id: b.id,
        stateIds: [...b.members].sort((a, b) => a - b),
        accepting: b.accepting,
      }))
      .sort((a, b) => a.id - b.id);
  }

  /** 把最终等价类合并为最小 DFA */
  private buildMinDfa(): MinDFA {
    const finalBlocks = [...this.blocks].sort(
      (a, b) => minMember(a) - minMember(b),
    );

    // 输出编号按“块中最小原状态”排序，保证初始块通常为 q0
    const oldToNew = new Map<number, number>();
    finalBlocks.forEach((b, i) => {
      for (const m of b.members) oldToNew.set(m, i);
    });

    const deadOriginal = this.dfa.states.find((s) => s.dead)?.id;

    const states: MinDFAState[] = finalBlocks.map((b, i) => {
      const members = [...b.members].sort((a, b2) => a - b2);
      const rep = this.dfa.states.find((s) => s.id === members[0])!;
      return {
        id: i,
        members,
        subset: rep.subset,
        accept: b.accepting,
        ...(deadOriginal !== undefined && b.members.has(deadOriginal)
          ? { dead: true as const }
          : {}),
      };
    });

    const mergeMap: Record<number, number> = {};
    for (const [oldId, newId] of oldToNew) mergeMap[oldId] = newId;

    const startId = oldToNew.get(this.dfa.startId)!;
    const acceptIds = states.filter((s) => s.accept).map((s) => s.id);
    const deadNew = states.find((s) => s.dead)?.id;

    // 用每块的最小成员查原转移表，生成最小 DFA 的完整转移
    const raw: DFATransition[] = [];
    const byPair = new Map<string, { from: number; to: number; ranges: CharRange[] }>();
    let tid = 0;
    for (const st of states) {
      const representative = st.members[0];
      this.reps.forEach((rep, i) => {
        const oldDest = this.delta.get(`${representative}|${rep}`)!;
        const to = oldToNew.get(oldDest)!;
        raw.push({ id: tid++, from: st.id, to, charCode: rep });
        const gk = `${st.id}->${to}`;
        let g = byPair.get(gk);
        if (!g) {
          g = { from: st.id, to, ranges: [] };
          byPair.set(gk, g);
        }
        g.ranges.push(this.regions[i]);
      });
    }

    const edges: DFAEdgeGroup[] = [];
    const deadEdges: DFAEdgeGroup[] = [];
    for (const g of byPair.values()) {
      const group: DFAEdgeGroup = {
        id: `${g.from}-${g.to}`,
        from: g.from,
        to: g.to,
        ranges: normalizeRanges(g.ranges),
      };
      if (deadNew !== undefined && g.to === deadNew) deadEdges.push(group);
      else edges.push(group);
    }
    edges.sort((a, b) => a.from - b.from || a.to - b.to);
    deadEdges.sort((a, b) => a.from - b.from);

    return {
      states,
      transitions: raw,
      edges,
      deadEdges,
      startId,
      acceptIds,
      alphabet: [...this.reps],
      regions: this.regions,
      mergeMap,
    };
  }
}

function minMember(b: Block): number {
  let m = Infinity;
  for (const s of b.members) if (s < m) m = s;
  return m;
}

function fmtCode(code: number): string {
  if (code === 9) return "'\\t'";
  if (code === 10) return "'\\n'";
  if (code === 13) return "'\\r'";
  if (code === 32) return "' '";
  const ch = String.fromCodePoint(code);
  return /^[ -~]$/.test(ch) ? `'${ch}'` : `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function hopcroftMinimize(dfa: DFA): HopcroftResult {
  return new HopcroftMinimizer(dfa).run();
}
