import React from 'react';
import type { DFASimResult, MinDFA } from '@shared/types';
import { StateGraph, type GraphEdgeVM, type GraphStateVM } from './StateGraph';
import { rangesToText } from '../lib/format';

interface MinDfaPanelProps {
  minDfa: MinDFA;
  sim: DFASimResult | null;
  simPos: number;
}

/** 最小化结果：合并后的最小 DFA + “哪些原状态被合并了”对照表 */
export const MinDfaPanel: React.FC<MinDfaPanelProps> = ({ minDfa, sim, simPos }) => {
  const states: GraphStateVM[] = minDfa.states.map((s) => ({
    id: s.id,
    name: `Q${s.id}`,
    accept: s.accept,
    dead: s.dead,
    badge:
      s.members.length > 1
        ? `合并 q${s.members.join(', q')}`
        : `= q${s.members[0]}`,
  }));

  const edges: GraphEdgeVM[] = minDfa.edges.map((g) => ({
    id: g.id,
    from: g.from,
    to: g.to,
    label: rangesToText(g.ranges, 4),
  }));

  const simActive = sim !== null && simPos > 0;
  const simStep = simActive ? sim!.steps[simPos] : undefined;

  return (
    <section className="stage panel" id="stage-min">
      <header className="stage-header">
        <h2>⑤ 最小化 DFA（合并等价状态后的最终机器）</h2>
        <div className="stage-stats">
          {minDfa.states.length} 个状态（原 DFA 为 {Object.keys(minDfa.mergeMap).length} 个）
        </div>
      </header>

      <StateGraph
        states={states}
        edges={edges}
        startId={minDfa.startId}
        resetKey={`min-${minDfa.states.length}`}
        highlightStates={simActive ? [simStep!.stateId] : []}
        highlightEdges={simActive ? sim!.steps.slice(0, simPos + 1).map((s) => s.edgeId).filter((x): x is string => x !== null) : []}
      />

      <div className="merge-table-wrap">
        <h3>合并对照表</h3>
        <table className="merge-table">
          <thead>
            <tr>
              <th>最小 DFA 状态</th>
              <th>由这些原 DFA 状态合并而成</th>
            </tr>
          </thead>
          <tbody>
            {minDfa.states.map((s) => (
              <tr key={s.id} className={s.members.length > 1 ? 'merged' : ''}>
                <td>
                  <strong>Q{s.id}</strong>
                  {s.accept && <span className="acc-tag">接受</span>}
                  {s.dead && <span className="dead-tag">死</span>}
                </td>
                <td>
                  {s.members.map((m) => `q${m}`).join('  +  ')}
                  {s.members.length > 1 && <span className="equiv-note"> —— 彼此等价</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
