import React from 'react';
import type { DFA, DFASimResult, HopcroftStep } from '@shared/types';
import { StateGraph, colorForBlock, type GraphEdgeVM, type GraphStateVM } from './StateGraph';
import { StepControls } from './StepControls';
import { rangesToText } from '../lib/format';

interface HopcroftPanelProps {
  dfa: DFA;
  steps: HopcroftStep[];
  stepIndex: number;
  onStepChange: (i: number) => void;
  sim: DFASimResult | null;
  simPos: number;
}

function subsetBadge(dfa: DFA, id: number): string {
  const subset = dfa.states.find((s) => s.id === id)?.subset ?? [];
  if (subset.length === 0) return '∅';
  if (subset.length <= 4) return `{${subset.map((s) => `n${s}`).join(',')}}`;
  return `{${subset.slice(0, 4).map((s) => `n${s}`).join(',')}…}+${subset.length - 4}`;
}

/** Hopcroft 划分视图：底图仍是原 DFA，状态颜色 = 所属等价类 */
export const HopcroftPanel: React.FC<HopcroftPanelProps> = ({
  dfa,
  steps,
  stepIndex,
  onStepChange,
  sim,
  simPos,
}) => {
  const step = steps[stepIndex] ?? steps[steps.length - 1];

  const stateColor = new Map<number, { fill: string; stroke: string }>();
  const blockOf = new Map<number, number>();
  for (const b of step?.blocks ?? []) {
    for (const id of b.stateIds) {
      stateColor.set(id, colorForBlock(b.id));
      blockOf.set(id, b.id);
    }
  }

  // 分裂发生时，把被拆的两块点亮，其余压暗
  const focusBlocks = step?.split ? new Set(step.split.newBlockIds) : null;
  const dimStates = new Set<number>();
  if (focusBlocks) {
    for (const b of step.blocks) {
      if (!focusBlocks.has(b.id)) for (const id of b.stateIds) dimStates.add(id);
    }
  }

  const states: GraphStateVM[] = dfa.states.map((s) => ({
    id: s.id,
    name: `q${s.id}`,
    accept: s.accept,
    dead: s.dead,
    badge: `P${blockOf.get(s.id) ?? '?'} · ${subsetBadge(dfa, s.id)}`,
  }));

  const edges: GraphEdgeVM[] = dfa.edges.map((g) => ({
    id: g.id,
    from: g.from,
    to: g.to,
    label: rangesToText(g.ranges, 4),
  }));

  const simActive = sim !== null && simPos > 0;
  const simStep = simActive ? sim!.steps[simPos] : undefined;

  return (
    <section className="stage panel" id="stage-hopcroft">
      <header className="stage-header">
        <h2>④ Hopcroft 最小化：等价类划分</h2>
        <div className="stage-stats">
          {(step?.blocks.length ?? 0)} 个等价类 / {dfa.states.length} 个原状态
        </div>
      </header>

      <StepControls
        total={steps.length}
        index={stepIndex}
        onChange={onStepChange}
        onPrev={() => onStepChange(Math.max(0, stepIndex - 1))}
        onNext={() => onStepChange(Math.min(steps.length - 1, stepIndex + 1))}
        onStart={() => onStepChange(0)}
        onFinish={() => onStepChange(steps.length - 1)}
        nextLabel="下一轮分裂"
      />

      {step && (
        <div className="step-desc">
          <span className={`step-kind kind-${step.kind}`}>
            {step.kind === 'init' ? '初始划分' : step.kind === 'split' ? '分裂' : '收敛'}
          </span>
          {step.description}
        </div>
      )}

      <StateGraph
        states={states}
        edges={edges}
        startId={dfa.startId}
        resetKey={`hop-${dfa.states.length}`}
        stateColor={stateColor}
        dimStates={dimStates.size > 0 ? dimStates : undefined}
        highlightStates={simActive ? [simStep!.stateId] : step?.pivotState !== undefined ? [step.pivotState] : []}
        highlightEdges={simActive ? sim!.steps.slice(0, simPos + 1).map((s) => s.edgeId).filter((x): x is string => x !== null) : []}
      />

      <div className="block-legend">
        {(step?.blocks ?? []).map((b) => (
          <span
            key={b.id}
            className={`block-chip ${focusBlocks && !focusBlocks.has(b.id) ? 'muted' : ''}`}
          >
            <i className="block-dot" style={{ background: colorForBlock(b.id).fill, borderColor: colorForBlock(b.id).stroke }} />
            P{b.id}（{b.accepting ? '接受' : '非接受'}）: q{b.stateIds.join(', q')}
          </span>
        ))}
      </div>
    </section>
  );
};
