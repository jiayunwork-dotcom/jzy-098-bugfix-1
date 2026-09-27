import React from 'react';
import type { NFASimResult, NFA, ThompsonStep } from '@shared/types';
import { StateGraph, type GraphEdgeVM, type GraphStateVM } from './StateGraph';
import { StepControls } from './StepControls';
import { labelToText } from '../lib/format';

interface NFAPanelProps {
  pattern: string;
  steps: ThompsonStep[];
  finalNfa: NFA;
  stepIndex: number;
  onStepChange: (i: number) => void;
  sim: NFASimResult | null;
  simPos: number;
}

export const NFAPanel: React.FC<NFAPanelProps> = ({
  pattern,
  steps,
  finalNfa,
  stepIndex,
  onStepChange,
  sim,
  simPos,
}) => {
  const isFinal = stepIndex >= steps.length - 1;
  const shown = isFinal ? finalNfa : steps[stepIndex]?.nfa ?? finalNfa;
  const step = steps[stepIndex];

  const states: GraphStateVM[] = shown.states.map((s) => ({
    id: s.id,
    name: `n${s.id}`,
    accept: s.accept,
  }));
  const edges: GraphEdgeVM[] = shown.transitions.map((t) => ({
    id: String(t.id),
    from: t.from,
    to: t.to,
    label: labelToText(t.label),
    dashed: t.label.kind === 'eps',
  }));

  // 测试路径只在最终 NFA 上有意义（中间快照编号会重排）
  const simStep = sim && isFinal && simPos > 0 ? sim.steps[simPos] : undefined;

  const span = step?.sourceSpan;
  const epsCount = shown.transitions.filter((t) => t.label.kind === 'eps').length;

  return (
    <section className="stage panel" id="stage-nfa">
      <header className="stage-header">
        <h2>② Thompson 构造：带 ε 转移的 NFA</h2>
        <div className="stage-stats">
          {shown.states.length} 个状态 · {shown.transitions.length} 条边（其中 {epsCount} 条 ε）
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
        nextLabel="下一片段"
      />

      {step && (
        <div className="step-desc">
          <span className="step-kind">第 {stepIndex + 1} 个片段</span>
          {step.description}
        </div>
      )}

      {span && (
        <div className="span-strip" title="当前片段在正则中的位置">
          {pattern.split('').map((ch, i) => (
            <span key={i} className={i >= span.start && i < span.end ? 'span-hot' : ''}>
              {ch}
            </span>
          ))}
        </div>
      )}

      <StateGraph
        states={states}
        edges={edges}
        startId={shown.startId}
        resetKey={`nfa-${pattern}`}
        emptyText="Thompson 构造后这里会出现 NFA"
        highlightStates={simStep?.activeStates}
        highlightEdges={
          simStep
            ? [...simStep.epsilonEdges.map(String), ...simStep.symbolEdges.map(String)]
            : []
        }
      />
      {sim && !isFinal && (
        <div className="sim-hint">提示：测试路径显示在最终 NFA 上，点“跑完”即可看到。</div>
      )}
    </section>
  );
};
