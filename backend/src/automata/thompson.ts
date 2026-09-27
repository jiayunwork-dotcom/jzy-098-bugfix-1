import type {
  Label,
  NFA,
  NFAState,
  NFATransition,
  ThompsonStep,
} from '../../../shared/types';
import type { ASTNode, CharNode, ClassNode, UnaryNode } from '../parser/parser';
import { EPS_LABEL, labelToText, setLabel } from './labels';

/**
 * Thompson 构造：把正则 AST 逐片段拼成一台带 ε 转移的 NFA。
 *
 * 每个片段都满足统一形状：一个入口状态（非接受）、一个出口接受状态，
 * 入口没有其它入边、出口没有其它出边 —— 因此各算子可以机械地嵌套拼接。
 *
 * 构造过程产出逐步快照 thompsonSteps：每处理完一个 AST 节点，
 * 就把当前“已经长出来的整台 NFA”连同新增状态/转移一起记录下来。
 */

interface Fragment {
  start: number;
  accept: number;
  /** 该片段对应的 AST 节点（用于说明与源码高亮） */
  node: ASTNode;
}

export class ThompsonBuilder {
  private states: NFAState[] = [];
  private transitions: NFATransition[] = [];
  private transitionSeq = 0;
  private steps: ThompsonStep[] = [];

  build(root: ASTNode): { nfa: NFA; steps: ThompsonStep[] } {
    const frag = this.buildNode(root);
    // 根片段的出口即全局唯一接受态
    this.states[frag.accept].accept = true;

    const nfa = this.snapshot(frag.start, frag.accept);
    return { nfa, steps: this.steps };
  }

  private newState(): number {
    const id = this.states.length;
    this.states.push({ id, initial: false, accept: false });
    return id;
  }

  private addTransition(from: number, to: number, label: Label): number {
    const id = this.transitionSeq++;
    this.transitions.push({ id, from, to, label });
    return id;
  }

  private buildNode(node: ASTNode): Fragment {
    let frag: Fragment;
    switch (node.kind) {
      case 'char':
      case 'class':
        frag = this.buildAtom(node);
        break;
      case 'concat':
        frag = this.buildConcat(node);
        break;
      case 'alt':
        frag = this.buildAlt(node);
        break;
      case 'star':
      case 'plus':
      case 'opt':
        frag = this.buildUnary(node);
        break;
    }
    this.recordStep(node, frag);
    return frag;
  }

  /** 叶子： --label--> */
  private buildAtom(node: CharNode | ClassNode): Fragment {
    const start = this.newState();
    const accept = this.newState();
    const label: Label =
      node.kind === 'char'
        ? setLabel([{ lo: node.code, hi: node.code }])
        : setLabel(node.ranges, node.negated);
    this.addTransition(start, accept, label);
    return { start, accept, node };
  }

  /** 连接：S1 的出口与 S2 的入口合并为同一个状态 */
  private buildConcat(node: Extract<ASTNode, { kind: 'concat' }>): Fragment {
    const subs = node.children.map((c) => this.buildNode(c));
    for (let i = 0; i < subs.length - 1; i++) {
      this.mergeStates(subs[i].accept, subs[i + 1].start);
    }
    return { start: subs[0].start, accept: subs[subs.length - 1].accept, node };
  }

  /** 选择：新建入口/出口，用 ε 把每个分支挂上去 */
  private buildAlt(node: Extract<ASTNode, { kind: 'alt' }>): Fragment {
    const entry = this.newState();
    const exit = this.newState();
    const subs = node.children.map((c) => this.buildNode(c));
    for (const s of subs) {
      this.addTransition(entry, s.start, EPS_LABEL);
      this.addTransition(s.accept, exit, EPS_LABEL);
    }
    return { start: entry, accept: exit, node };
  }

  /** 闭包 *、正闭包 +、可选 ?：复用统一的 ε 骨架 */
  private buildUnary(node: UnaryNode): Fragment {
    const sub = this.buildNode(node.child);
    const entry = this.newState();
    const exit = this.newState();

    if (node.kind === 'star') {
      // entry -> S.start; S.accept -> S.start（回环）; S.accept -> exit; entry -> exit（跳过）
      this.addTransition(entry, sub.start, EPS_LABEL);
      this.addTransition(sub.accept, sub.start, EPS_LABEL);
      this.addTransition(sub.accept, exit, EPS_LABEL);
      this.addTransition(entry, exit, EPS_LABEL);
    } else if (node.kind === 'plus') {
      // 至少一次：没有 entry -> exit 的跳过边，但保留回环
      this.addTransition(entry, sub.start, EPS_LABEL);
      this.addTransition(sub.accept, sub.start, EPS_LABEL);
      this.addTransition(sub.accept, exit, EPS_LABEL);
    } else {
      // 可选：可走片段，也可直接跳过
      this.addTransition(entry, sub.start, EPS_LABEL);
      this.addTransition(entry, exit, EPS_LABEL);
      this.addTransition(sub.accept, exit, EPS_LABEL);
    }
    return { start: entry, accept: exit, node };
  }

  /**
   * 把状态 b 合并进状态 a：所有指向 b 的边改指向 a，b 标记保留（稍后丢弃）。
   * Thompson 连接用它把前一片段出口和后一片段入口焊在一起。
   */
  private mergeStates(a: number, b: number): void {
    for (const t of this.transitions) {
      if (t.from === b) t.from = a;
      if (t.to === b) t.to = a;
    }
  }

  private recordStep(node: ASTNode, frag: Fragment): void {
    // 从当前片段入口可达的状态，恰好是该算子片段的全部成员
    // （连接时被焊接掉的中间状态作为残留被排除）。
    const reachable = this.collectReachable(frag.start);
    const nfa = this.compactSnapshot(reachable, frag.start, frag.accept);

    this.steps.push({
      index: this.steps.length,
      description: describeNode(node),
      sourceSpan: node.span,
      nfa,
      fragStart: nfa.startId,
      fragAccept: nfa.acceptId,
      // 快照是压缩后的编号，新增对象难以逐一映射；交给前端用最新一步整体高亮
      newStates: nfa.states.map((s) => s.id),
      newTransitions: nfa.transitions.map((t) => t.id),
    });
  }

  /**
   * 只收集“当前已构建部分”可达的状态。
   * 因为连接会先建左再建右，构建右片段时左片段已经焊接好；
   * 对当前节点而言，从其入口可达的状态恰好是属于它的全部状态。
   */
  private collectReachable(start: number): Set<number> {
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      const s = stack.pop()!;
      for (const t of this.transitions) {
        if (t.from === s && !seen.has(t.to)) {
          seen.add(t.to);
          stack.push(t.to);
        }
      }
    }
    return seen;
  }

  /** 压缩快照：丢弃焊接残留状态并重新编号，输出一份独立 NFA 给前端 */
  private compactSnapshot(keep: Set<number>, rawStart: number, rawAccept: number): NFA {
    const remap = new Map<number, number>();
    const keptStates = this.states.filter((s) => keep.has(s.id));
    keptStates.forEach((s, i) => remap.set(s.id, i));

    const states: NFAState[] = keptStates.map((s) => ({
      id: remap.get(s.id)!,
      initial: s.id === rawStart,
      accept: s.id === rawAccept,
    }));

    const keptTransitions = this.transitions.filter(
      (t) => keep.has(t.from) && keep.has(t.to),
    );
    // 边 id 重新编号，保证每一步快照内部自洽
    const transitions: NFATransition[] = keptTransitions.map((t, i) => ({
      id: i,
      from: remap.get(t.from)!,
      to: remap.get(t.to)!,
      label: t.label,
    }));

    return {
      states,
      transitions,
      startId: remap.get(rawStart)!,
      acceptId: remap.get(rawAccept)!,
    };
  }

  private snapshot(start: number, accept: number): NFA {
    // 最终 NFA：全部活动状态都应可达；压缩焊接残留后输出
    const reachable = this.collectReachable(start);
    return this.compactSnapshot(reachable, start, accept);
  }
}

function describeNode(node: ASTNode): string {
  switch (node.kind) {
    case 'char':
      return `字符 “${labelToText(setLabel([{ lo: node.code, hi: node.code }]))}”：建一条带标签的边连接两个新状态`;
    case 'class':
      return `字符集合 ${node.preview}：建一条标签为“${node.negated ? '非 ' : ''}${labelToText(
        setLabel(node.ranges, node.negated),
      )}”的边`;
    case 'concat':
      return `连接：把 ${node.children.length} 个片段首尾焊接起来（前一个的出口 = 后一个的入口）`;
    case 'alt':
      return `选择 |：新建入口/出口，用 ε 边把 ${node.children.length} 个分支并联`;
    case 'star':
      return `闭包 *：加 ε 回环允许重复任意次，再加一条 ε 跳过边允许重复 0 次`;
    case 'plus':
      return `正闭包 +：加 ε 回环允许重复，但必须先走一次（无跳过边）`;
    case 'opt':
      return `可选 ?：用 ε 边并联原片段与一条跳过路径，整体出现 0 次或 1 次`;
  }
}

export function thompsonConstruct(root: ASTNode): { nfa: NFA; steps: ThompsonStep[] } {
  return new ThompsonBuilder().build(root);
}
