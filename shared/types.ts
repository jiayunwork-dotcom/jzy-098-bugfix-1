/**
 * 前后端共享的结构化数据类型。
 * 该文件只包含 type / interface，编译后被擦除，前后端各自引用同一份定义。
 */

/** 字符区间，闭区间 [lo, hi]，以 Unicode 码点表示 */
export interface CharRange {
  lo: number;
  hi: number;
}

/** 转移标签：空转移 ε，或一个字符集合（单字符时集合只有一个码点） */
export type Label =
  | { kind: 'eps' }
  | { kind: 'set'; ranges: CharRange[]; negated: boolean };

export interface PosRange {
  /** 起始字符位置（0 基，含） */
  start: number;
  /** 结束字符位置（0 基，不含） */
  end: number;
}

export interface NFAState {
  id: number;
  initial: boolean;
  accept: boolean;
}

export interface NFATransition {
  id: number;
  from: number;
  to: number;
  label: Label;
}

export interface NFA {
  states: NFAState[];
  transitions: NFATransition[];
  startId: number;
  acceptId: number;
}

/** Thompson 构造的每一步：一个算子片段被拼进已有 NFA */
export interface ThompsonStep {
  /** 第几步，0 基 */
  index: number;
  /** 中文说明，例如“闭包 *：把 S1 包成可重复 0 次或多次” */
  description: string;
  /** 对应的 AST 片段在源码中的位置，供前端高亮正则文本 */
  sourceSpan: PosRange;
  /** 当前这一步处理完之后，已生成的完整 NFA（只增不改） */
  nfa: NFA;
  /** 当前片段入口/出口状态（本步主角） */
  fragStart: number;
  fragAccept: number;
  /** 该片段包含的全部状态与转移（每步快照内独立编号，前端整体高亮） */
  newStates: number[];
  newTransitions: number[];
}

export interface DFAState {
  id: number;
  /** 该 DFA 状态对应的 NFA 状态闭包集合（始终给出，包括最小化之后） */
  subset: number[];
  accept: boolean;
  /** 是否为补全转移而加入的死状态 */
  dead?: boolean;
}

/** 原始确定性转移：每个字符码点唯一指向一个目标状态 */
export interface DFATransition {
  id: number;
  from: number;
  to: number;
  charCode: number;
}

/** 供前端画边用的合并标签：同一对 (from,to) 的连续码点区间 */
export interface DFAEdgeGroup {
  id: string;
  from: number;
  to: number;
  ranges: CharRange[];
}

export interface DFA {
  states: DFAState[];
  transitions: DFATransition[];
  edges: DFAEdgeGroup[];
  /** 通往死状态的边（默认不画，可在前端开关中展开；标签为“其它字符”） */
  deadEdges: DFAEdgeGroup[];
  startId: number;
  acceptIds: number[];
  /** 出现过的全部输入字符区域的代表码点（升序） */
  alphabet: number[];
  /** 字符同行为区域，互不相交且覆盖整个码点空间；与 alphabet 对齐 */
  regions: CharRange[];
}

export type SubsetEventKind =
  | 'closure' // 对某个种子集合求 ε-闭包
  | 'state' // 注册一个新 DFA 状态
  | 'move' // 沿字符 a 的迁移
  | 'dead'; // 补上通往死状态的转移

export interface SubsetStep {
  index: number;
  description: string;
  /** 本步执行后，DFA 已经长成的样子 */
  dfa: DFA;
  kind: SubsetEventKind;
  /** 正在处理的 DFA 状态（种子状态） */
  currentState?: number;
  /** 正在处理的字符码点 */
  charCode?: number;
  /** 本步涉及的 NFA 状态集合（闭包结果等） */
  subset: number[];
  /** 本步新建的状态 / 转移 */
  newState?: number;
  newTransitionId?: number;
  /** 完整子集对照表：DFA 状态 -> NFA 状态集合（随步骤推进增长） */
  table: { stateId: number; subset: number[]; accept: boolean }[];
}

export type HopcroftEventKind = 'init' | 'split' | 'done';

export interface HopcroftSplitInfo {
  /** 被拆分的块 id */
  blockId: number;
  /** 拆分后产生的块 id 列表（有序） */
  newBlockIds: number[];
  /** 触发拆分的状态与字符 */
  stateId: number;
  charCode: number;
}

export interface HopcroftStep {
  index: number;
  description: string;
  kind: HopcroftEventKind;
  /** 划分中的每一块（id 在整个过程中保持稳定，便于前端做颜色对应） */
  blocks: { id: number; stateIds: number[]; accepting: boolean }[];
  /** 本步被选中去做分裂检查的“指示状态” */
  pivotState?: number;
  pivotChar?: number;
  split?: HopcroftSplitInfo;
}

export interface MinDFAState {
  id: number;
  /** 最小化后该块代表的所有原 DFA 状态 */
  members: number[];
  /** 取成员状态中最小的那个子集作为代表（成员子集彼此等价） */
  subset: number[];
  accept: boolean;
  dead?: boolean;
}

export interface MinDFA extends DFA {
  states: MinDFAState[];
  /** 原 DFA 状态 -> 最小化 DFA 状态（合并对照表） */
  mergeMap: Record<number, number>;
}

export interface BuildData {
  pattern: string;
  nfa: NFA;
  thompsonSteps: ThompsonStep[];
  dfa: DFA;
  subsetSteps: SubsetStep[];
  minDfa: MinDFA;
  hopcroftSteps: HopcroftStep[];
}

export interface BuildError {
  message: string;
  position?: number;
  endPosition?: number;
  source?: string;
}

export type BuildResponse =
  | { ok: true; data: BuildData }
  | { ok: false; error: BuildError };

/* ---------- 测试串模拟 ---------- */

export interface NFASimStep {
  /** 读入到第几个字符（0 表示还没开始读） */
  pos: number;
  /** 当前激活的 NFA 状态集合 */
  activeStates: number[];
  /** 本阶段走过的空转移（闭包内部使用，按顺序） */
  epsilonEdges: number[];
  /** 本步真正消费字符走过的转移（一个字符可并发多条） */
  symbolEdges: number[];
  /** 本步消费的字符（初始闭包步为空） */
  char?: string;
  charCode?: number;
  /** 到本步为止读到的前缀能否被接受 */
  prefixAccepted: boolean;
}

export interface NFASimResult {
  kind: 'nfa';
  steps: NFASimStep[];
  accepted: boolean;
}

export interface DFASimStep {
  pos: number;
  stateId: number;
  /** 本步走的边组（from/to 相同）；无路可走时为 null */
  edgeId: string | null;
  char?: string;
  charCode?: number;
}

export interface DFASimResult {
  kind: 'dfa' | 'min';
  steps: DFASimStep[];
  accepted: boolean;
  /** 最小化 DFA 上，当前块代表的原 DFA 状态（便于回看） */
  memberStates?: number[];
}

export type SimResult = NFASimResult | DFASimResult;

export interface SimResponse {
  ok: true;
  pattern: string;
  input: string;
  nfa: NFASimResult;
  dfa: DFASimResult;
  min: DFASimResult;
  /** 三台机器结论是否一致 —— 贯穿全局的正确性主线 */
  agree: boolean;
}
