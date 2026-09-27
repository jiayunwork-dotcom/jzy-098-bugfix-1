import React, { useState } from 'react';
import type { DFASimResult, DFA, SubsetStep } from '@shared/types';
import { StateGraph, type GraphEdgeVM, type GraphStateVM } from './StateGraph';
import { StepControls } from './StepControls';
import { SubsetTable } from './SubsetTable';
import { rangesToText } from '../lib/format';

interface DFAPanelProps {
  steps: SubsetStep[];
  finalDfa: DFA;
  stepIndex: number;
  onStepChange: (i: number) => void;
  sim: DFASimResult | null;
  simPos: number;
}

function badgeFor(subset: number[]): string {
  if (subset.length === 0) return '∅';
  if (subset.length <= 4) return `{${subset.map((s) => `n${s}`).join(',')}}`;
  return `{${subset.slice(0, 4).map((s) => `n${s}`).join(',')}…}+${subset.length - 4}`;
}

export const DFAPanel: React.FC<DFAPanelProps> = ({
  steps,
  finalDfa,
  stepIndex,
  onStepChange,
  sim,
  simPos,
}) => {
  const [showDead, setShowDead] = useState(false);
  const isFinal = stepIndex >= steps.length - 1;
  const step: SubsetStep | undefined = steps[stepIndex];
  const shown = isFinal ? finalDfa : step?.dfa ?? finalDfa;

  const visibleEdges = showDead ? [...shown.edges, ...shown.deadEdges] : shown.edges;

  const states: GraphStateVM[] = shown.states.map((s) => ({
    id: s.id,
    name: `q${s.id}`,
    accept: s.accept,
    dead: s.dead,
    badge: badgeFor(s.subset),
  }));

  const edges: GraphEdgeVM[] = visibleEdges.map((g) => ({
    id: g.id,
    from: g.from,
    to: g.to,
    label: rangesToText(g.ranges, 4),
    dead: shown.deadEdges.includes(g),
  }));

  const simActive = sim !== null && simPos > 0;
  const simStep = simActive ? sim!.steps[simPos] : undefined;
  const traveledEdges = simActive
    ? sim!.steps.slice(0, simPos + 1).map((s) => s.edgeId).filter((x): x is string => x !== null)
    : [];

  const tableRows = (step?.table ?? []).map((r) => ({
    ...r,
    dead: shown.states.find((s) => s.id === r.stateId)?.dead,
    isNew: step.kind === 'state' && step.newState === r.stateId,
    isCurrent: step.currentState === r.stateId,
  }));

  return (
    <section className="stage panel" id="stage-dfa">
      <header className="stage-header">
        <h2>③ 子集构造：确定化的 DFA</h2>
        <div className="stage-stats">
          {shown.states.length} 个状态 · {shown.edges.length} 条边
          {shown.deadEdges.length > 0 && ` · ${shown.states.filter((s) => s.dead).length} 个死状态`}
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
        nextLabel="下一子集"
      />

      {step && (
        <div className="step-desc">
          <span className={`step-kind kind-${step.kind}`}>
            {step.kind === 'closure' ? 'ε-闭包' : step.kind === 'state' ? '新状态' : step.kind === 'move' ? '迁移' : '完成'}
          </span>
          {step.description}
        </div>
      )}

      <div className="dfa-body">
        <div className="dfa-graph-col">
          <StateGraph
            states={states}
            edges={edges}
            startId={shown.startId}
            resetKey={`dfa-${finalDfa.states.length}`}
            emptyText="子集构造后这里会出现 DFA"
            highlightStates={simActive ? [simStep!.stateId] : step?.newState !== undefined && step.kind === 'state' ? [step.newState] : step?.currentState !== undefined ? [step.currentState] : []}
            highlightEdges={traveledEdges}
          />
          {finalDfa.deadEdges.length > 0 && (
            <label className="dead-toggle">
              <input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} />
              显示通往死状态的补全转移（{finalDfa.deadEdges.length} 条灰色边）
            </label>
          )}
          {sim && (
            <div className="sim-hint">
              {simPos === 0
                ? '尚未读入字符，机器停在起始状态。'
                : <>当前读入位置：第 {simPos} 个字符，停在 <strong>q{simStep?.stateId}</strong></>}
            </div>
          )}
        </div>

        <aside className="subset-col">
          <h3>子集对照表</h3>
          <SubsetTable rows={tableRows} />
          <p className="table-note">
            每个 DFA 状态都等于一组 NFA 状态；只要两个集合在 ε-闭包下相同，就只建一个状态。
          </p>
        </aside>
      </div>
    </section>
  );
};
