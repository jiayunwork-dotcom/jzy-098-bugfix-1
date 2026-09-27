import React, { useCallback, useEffect, useState } from 'react';
import type { BuildData, BuildError, SimResponse } from '@shared/types';
import { fetchBuild, fetchExamples, fetchSimulate, type Example } from './api';
import { RegexInput } from './components/RegexInput';
import { NFAPanel } from './components/NFAPanel';
import { DFAPanel } from './components/DFAPanel';
import { HopcroftPanel } from './components/HopcroftPanel';
import { MinDfaPanel } from './components/MinDfaPanel';
import { TestRunner } from './components/TestRunner';

const DEFAULT_PATTERN = '(a|b)*abb';

const App: React.FC = () => {
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);
  const [examples, setExamples] = useState<Example[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<BuildError | null>(null);
  const [data, setData] = useState<BuildData | null>(null);

  const [nfaStep, setNfaStep] = useState(0);
  const [dfaStep, setDfaStep] = useState(0);
  const [hopStep, setHopStep] = useState(0);

  const [testInput, setTestInput] = useState('abb');
  const [simLoading, setSimLoading] = useState(false);
  const [sim, setSim] = useState<SimResponse | null>(null);
  const [simPos, setSimPos] = useState(0);

  useEffect(() => {
    fetchExamples().then(setExamples).catch(() => undefined);
  }, []);

  const doBuild = useCallback(
    async (p: string) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetchBuild(p);
        if (!resp.ok) {
          setError(resp.error);
          return;
        }
        setData(resp.data);
        setNfaStep(0);
        setDfaStep(0);
        setHopStep(0);
        setSim(null);
        setSimPos(0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // 首次进入自动构造默认示例，让页面不空
  useEffect(() => {
    doBuild(DEFAULT_PATTERN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAllStages = useCallback(() => {
    if (!data) return;
    setNfaStep(data.thompsonSteps.length - 1);
    setDfaStep(data.subsetSteps.length - 1);
    setHopStep(data.hopcroftSteps.length - 1);
  }, [data]);

  const doSimulate = useCallback(async () => {
    if (!pattern) return;
    setSimLoading(true);
    setError(null);
    try {
      // 始终按输入框里的当前正则构造（后端有缓存）；
      // 若与画面上的机器不同，就把三台机器一起刷新到该正则，保证“所见即所测”。
      const buildResp = await fetchBuild(pattern);
      if (!buildResp.ok) {
        setError(buildResp.error);
        return;
      }
      const current = buildResp.data;
      setData(current);
      setNfaStep(current.thompsonSteps.length - 1);
      setDfaStep(current.subsetSteps.length - 1);
      setHopStep(current.hopcroftSteps.length - 1);

      const resp = await fetchSimulate(current.pattern, testInput);
      if (!resp.ok) {
        setError((resp as unknown as { error: BuildError }).error);
        return;
      }
      setSim(resp);
      setSimPos(testInput.length);
    } finally {
      setSimLoading(false);
    }
  }, [pattern, testInput]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>正则 → NFA → DFA → 最小化 DFA · 构造流水线</h1>
        <p className="subtitle">
          后端跑全部构造算法，前端把 Thompson 构造、子集构造、Hopcroft 最小化一步步演给你看
        </p>
      </header>

      <div className="layout">
        <div className="sidebar">
          <RegexInput
            pattern={pattern}
            onPatternChange={setPattern}
            onBuild={() => doBuild(pattern)}
            loading={loading}
            error={error}
            examples={examples}
          />
          {data && (
            <div className="panel quick-actions">
              <button className="btn btn-build wide" onClick={runAllStages}>
                ⏩ 一键把三段全部演到最终机器
              </button>
              <div className="pipeline-mini">
                <span>正则</span> → <span>NFA({data.nfa.states.length})</span> →{' '}
                <span>DFA({data.dfa.states.length})</span> →{' '}
                <span className="final">最小({data.minDfa.states.length})</span>
              </div>
            </div>
          )}
        </div>

        <main className="content">
          {data ? (
            <>
              <NFAPanel
                pattern={data.pattern}
                steps={data.thompsonSteps}
                finalNfa={data.nfa}
                stepIndex={nfaStep}
                onStepChange={setNfaStep}
                sim={sim?.nfa ?? null}
                simPos={simPos}
              />
              <DFAPanel
                steps={data.subsetSteps}
                finalDfa={data.dfa}
                stepIndex={dfaStep}
                onStepChange={setDfaStep}
                sim={sim?.dfa ?? null}
                simPos={simPos}
              />
              <HopcroftPanel
                dfa={data.dfa}
                steps={data.hopcroftSteps}
                stepIndex={hopStep}
                onStepChange={setHopStep}
                sim={sim?.min ?? null}
                simPos={simPos}
              />
              <MinDfaPanel minDfa={data.minDfa} sim={sim?.min ?? null} simPos={simPos} />
              <TestRunner
                input={testInput}
                onInputChange={(s) => {
                  setTestInput(s);
                  setSimPos(s.length);
                }}
                onRun={doSimulate}
                loading={simLoading}
                result={sim}
                pos={simPos}
                onPosChange={setSimPos}
                disabled={!data}
              />
            </>
          ) : (
            <div className="placeholder panel">
              {loading ? '正在构造…' : error ? '请修正左侧正则后重新构造。' : '输入正则后点击“构造”开始。'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
