export interface GraphNodeInput {
  id: number;
}

export interface GraphEdgeInput {
  id: string;
  from: number;
  to: number;
}

export interface LayoutNode {
  id: number;
  x: number;
  y: number;
  rank: number;
}

export interface LayoutEdge {
  id: string;
  from: number;
  to: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 路径弯曲偏移（贝塞尔控制点相对中线的垂直偏移） */
  bend: number;
  selfLoop: boolean;
}

export interface Layout {
  nodes: Map<number, LayoutNode>;
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const X_GAP = 190;
const Y_GAP = 110;
const MARGIN_X = 70;
const MARGIN_Y = 70;

/**
 * 分层布局：从初始态做 BFS 得到最短层（rank），同层状态纵向排布。
 * 回边/同层边走贝塞尔曲线，自环单独画弧。
 * 状态很多时画布变宽/变高，外层容器负责滚动。
 */
export function layeredLayout(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  startId: number,
): Layout {
  const adj = new Map<number, number[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
  }

  // BFS 分层（自环不参与分层）
  const rankOf = new Map<number, number>();
  const queue = [startId];
  rankOf.set(startId, 0);
  while (queue.length) {
    const s = queue.shift()!;
    for (const t of adj.get(s) ?? []) {
      if (!rankOf.has(t)) {
        rankOf.set(t, (rankOf.get(s) ?? 0) + 1);
        queue.push(t);
      }
    }
  }
  // 与初始态不连通的防御性处理（构造上不应出现）
  for (const n of nodes) if (!rankOf.has(n.id)) rankOf.set(n.id, 0);

  const byRank = new Map<number, number[]>();
  for (const [id, rank] of rankOf) {
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank)!.push(id);
  }
  for (const list of byRank.values()) list.sort((a, b) => a - b);

  const maxRank = Math.max(...byRank.keys());
  const maxCol = Math.max(...[...byRank.values()].map((l) => l.length));

  const layoutNodes = new Map<number, LayoutNode>();
  for (let r = 0; r <= maxRank; r++) {
    const col = byRank.get(r) ?? [];
    col.forEach((id, i) => {
      layoutNodes.set(id, {
        id,
        rank: r,
        x: MARGIN_X + r * X_GAP,
        y: MARGIN_Y + i * Y_GAP + ((maxCol - col.length) * Y_GAP) / 2,
      });
    });
  }

  // 检测双向边对，让两条边向相反方向弯
  const pairCount = new Map<string, number>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}->${b}` : `${b}->${a}`);

  const layoutEdges: LayoutEdge[] = edges.map((e) => {
    const a = layoutNodes.get(e.from)!;
    const b = layoutNodes.get(e.to)!;
    const selfLoop = e.from === e.to;
    let bend = 0;
    if (!selfLoop) {
      const key = edgeKey(e.from, e.to);
      const seen = pairCount.get(key) ?? 0;
      pairCount.set(key, seen + 1);
      const reverse = b.rank <= a.rank;
      if (reverse) bend = 46;
      if (seen > 0) bend = -46; // 配对的第二条反向弯
    }
    return {
      id: e.id,
      from: e.from,
      to: e.to,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      bend,
      selfLoop,
    };
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: MARGIN_X * 2 + maxRank * X_GAP,
    height: MARGIN_Y * 2 + (maxCol - 1) * Y_GAP,
  };
}
