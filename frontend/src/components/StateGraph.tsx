import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { layeredLayout, type Layout } from '../lib/graphLayout';
import { rangesToText } from '../lib/format';
import type { CharRange } from '@shared/types';

/* 视图模型：NFA / DFA / 最小化 DFA / Hopcroft 着色视图都先转成它 */

export interface GraphStateVM {
  id: number;
  name: string;
  accept: boolean;
  dead?: boolean;
  /** 圆圈下方小字，如 DFA 的子集 {n0,n1} 或最小态的成员 [1,5] */
  badge?: string;
}

export interface GraphEdgeVM {
  id: string;
  from: number;
  to: number;
  /** 直接给好的标签文本 */
  label: string;
  /** ε 边画成虚线 */
  dashed?: boolean;
  dead?: boolean;
}

interface StateGraphProps {
  states: GraphStateVM[];
  edges: GraphEdgeVM[];
  startId: number;
  /** 模拟路径：当前激活状态（填充高亮） */
  highlightStates?: number[];
  /** 模拟路径：当前走过的边 id 集合 */
  highlightEdges?: string[];
  /** Hopcroft：状态 -> 块颜色 */
  stateColor?: Map<number, string>;
  /** Hopcroft：把不属于当前关注块的其它状态压暗 */
  dimStates?: Set<number>;
  /** 空列表时的占位说明 */
  emptyText?: string;
  /** 数据版本号，切换正则后复位缩放 */
  resetKey?: string;
}

const R = 24; // 状态圆半径

/** Hopcroft 块配色：填充色 + 描边色 */
export const BLOCK_COLORS = [
  { fill: '#dbeafe', stroke: '#2563eb' },
  { fill: '#dcfce7', stroke: '#16a34a' },
  { fill: '#ffedd5', stroke: '#ea580c' },
  { fill: '#fce7f3', stroke: '#db2777' },
  { fill: '#ede9fe', stroke: '#7c3aed' },
  { fill: '#cffafe', stroke: '#0891b2' },
  { fill: '#fef9c3', stroke: '#ca8a04' },
  { fill: '#fee2e2', stroke: '#dc2626' },
  { fill: '#e0f2fe', stroke: '#0284c7' },
  { fill: '#f3e8ff', stroke: '#9333ea' },
];

export function colorForBlock(blockId: number): { fill: string; stroke: string } {
  return BLOCK_COLORS[blockId % BLOCK_COLORS.length];
}

export function rangesLabel(ranges: CharRange[]): string {
  return rangesToText(ranges, 4);
}

export const StateGraph: React.FC<StateGraphProps> = ({
  states,
  edges,
  startId,
  highlightStates,
  highlightEdges,
  stateColor,
  dimStates,
  emptyText,
  resetKey,
}) => {
  const layout: Layout = useMemo(
    () =>
      layeredLayout(
        states.map((s) => ({ id: s.id })),
        edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
        startId,
      ),
    [states, edges, startId],
  );

  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setView({ scale: 1, tx: 0, ty: 0 });
  }, [resetKey]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = Math.min(2.5, Math.max(0.3, v.scale * factor));
      // 以鼠标为锚点缩放
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    },
    [view],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  }, []);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const activeSet = new Set(highlightStates ?? []);
  const edgeActive = new Set(highlightEdges ?? []);
  const stateById = new Map(states.map((s) => [s.id, s]));

  return (
    <div
      ref={containerRef}
      className="graph-scroll"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {states.length === 0 ? (
        <div className="graph-empty">{emptyText ?? '暂无状态'}</div>
      ) : (
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
            </marker>
            <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#f97316" />
            </marker>
            <marker id="arrow-start" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#0f172a" />
            </marker>
          </defs>

          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            {/* 初始态标记 */}
            <StartMarker layout={layout} startId={startId} />

            {/* 边 */}
            {layout.edges.map((le) => {
              const vm = edges.find((e) => e.id === le.id)!;
              const hot = edgeActive.has(le.id);
              return (
                <EdgeShape
                  key={le.id}
                  le={le}
                  label={vm.label}
                  dashed={vm.dashed}
                  dead={vm.dead}
                  hot={hot}
                />
              );
            })}

            {/* 状态 */}
            {[...layout.nodes.values()].map((n) => {
              const vm = stateById.get(n.id)!;
              const color = stateColor?.get(n.id);
              const active = activeSet.has(n.id);
              const dim = dimStates && !dimStates.has(n.id);
              return (
                <g key={n.id} opacity={dim ? 0.3 : 1} className="state-node">
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={R}
                    fill={active ? '#fed7aa' : color?.fill ?? '#ffffff'}
                    stroke={active ? '#ea580c' : color?.stroke ?? '#334155'}
                    strokeWidth={active ? 3.5 : 2}
                  />
                  {vm.accept && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={R - 6}
                      fill="none"
                      stroke={active ? '#ea580c' : color?.stroke ?? '#334155'}
                      strokeWidth={2}
                    />
                  )}
                  <text
                    x={n.x}
                    y={n.y + 4}
                    textAnchor="middle"
                    fontSize={13}
                    fontWeight={600}
                    fill="#0f172a"
                  >
                    {vm.name}
                  </text>
                  {vm.dead && (
                    <text x={n.x} y={n.y - R - 6} textAnchor="middle" fontSize={11} fill="#94a3b8">
                      死状态
                    </text>
                  )}
                  {vm.badge !== undefined && (
                    <text
                      x={n.x}
                      y={n.y + R + 15}
                      textAnchor="middle"
                      fontSize={10.5}
                      fill="#64748b"
                      className="state-badge"
                    >
                      {vm.badge}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
};

/* 初始态的指向小箭头 */
const StartMarker: React.FC<{ layout: Layout; startId: number }> = ({ layout, startId }) => {
  const n = layout.nodes.get(startId);
  if (!n) return null;
  const x2 = n.x - R - 2;
  const x1 = x2 - 34;
  return (
    <g>
      <line x1={x1} y1={n.y} x2={x2} y2={n.y} stroke="#0f172a" strokeWidth={2} markerEnd="url(#arrow-start)" />
      <text x={x1 - 4} y={n.y - 8} fontSize={11} fill="#0f172a" fontWeight={700}>
        start
      </text>
    </g>
  );
};

interface EdgeShapeProps {
  le: Layout['edges'][number];
  label: string;
  dashed?: boolean;
  dead?: boolean;
  hot: boolean;
}

const EdgeShape: React.FC<EdgeShapeProps> = ({ le, label, dashed, dead, hot }) => {
  const stroke = hot ? '#f97316' : dead ? '#cbd5e1' : '#64748b';
  const width = hot ? 3.2 : 1.8;

  if (le.selfLoop) {
    // 自环：节点右上方画一段圆弧
    const cx = le.x1;
    const cy = le.y1;
    const sx = cx + R * 0.85;
    const sy = cy - R * 0.6;
    const ex = cx + R * 0.2;
    const ey = cy - R * 0.98;
    const path = `M ${sx} ${sy} A 22 22 0 1 1 ${ex + 0.1} ${ey + 0.1}`;
    const lx = cx + R + 26;
    const ly = cy - R - 18;
    return (
      <g>
        <path d={path} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dashed ? '6 4' : undefined} markerEnd={`url(#${hot ? 'arrow-hot' : 'arrow'})`} />
        <EdgeLabel x={lx} y={ly} text={label} hot={hot} dead={dead} />
      </g>
    );
  }

  const mx = (le.x1 + le.x2) / 2;
  const my = (le.y1 + le.y2) / 2;
  const dx = le.x2 - le.x1;
  const dy = le.y2 - le.y1;
  const len = Math.hypot(dx, dy) || 1;
  // 垂直于连线方向的单位向量
  const nx = -dy / len;
  const ny = dx / len;

  const cx = mx + nx * le.bend;
  const cy = my + ny * le.bend;

  // 与目标圆边界的交点：曲线末端切线方向为 (p2 - c)
  const tdx = le.x2 - cx;
  const tdy = le.y2 - cy;
  const tlen = Math.hypot(tdx, tdy) || 1;
  const endX = le.x2 - (tdx / tlen) * (R + 2);
  const endY = le.y2 - (tdy / tlen) * (R + 2);

  // 起点也缩到圆边界，用起点处切线 (c - p1)
  const sdx = cx - le.x1;
  const sdy = cy - le.y1;
  const slen = Math.hypot(sdx, sdy) || 1;
  const startX = le.x1 + (sdx / slen) * (R + 1);
  const startY = le.y1 + (sdy / slen) * (R + 1);

  // 标签位于二次贝塞尔 t=0.5 处
  const labelX = 0.25 * startX + 0.5 * cx + 0.25 * endX;
  const labelY = 0.25 * startY + 0.5 * cy + 0.25 * endY;

  return (
    <g>
      <path
        d={`M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dashed ? '6 4' : undefined}
        markerEnd={`url(#${hot ? 'arrow-hot' : 'arrow'})`}
      />
      <EdgeLabel x={labelX} y={labelY - 4} text={label} hot={hot} dead={dead} />
    </g>
  );
};

const EdgeLabel: React.FC<{ x: number; y: number; text: string; hot: boolean; dead?: boolean }> = ({
  x,
  y,
  text,
  hot,
  dead,
}) => (
  <g className="edge-label">
    <rect
      x={x}
      y={y - 10}
      width={Math.max(18, text.length * 7 + 8)}
      height={16}
      rx={4}
      fill="#ffffff"
      opacity={0.9}
      transform={`translate(${-(Math.max(18, text.length * 7 + 8)) / 2},0)`}
    />
    <text
      x={x}
      y={y + 2}
      textAnchor="middle"
      fontSize={11.5}
      fontWeight={hot ? 700 : 500}
      fill={hot ? '#ea580c' : dead ? '#94a3b8' : '#475569'}
    >
      {text}
    </text>
  </g>
);
