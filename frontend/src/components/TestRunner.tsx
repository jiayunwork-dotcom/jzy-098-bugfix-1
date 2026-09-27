import React from 'react';
import type { SimResponse } from '@shared/types';

interface TestRunnerProps {
  input: string;
  onInputChange: (s: string) => void;
  onRun: () => void;
  loading: boolean;
  result: SimResponse | null;
  pos: number;
  onPosChange: (p: number) => void;
  disabled: boolean;
}

const Verdict: React.FC<{ accepted: boolean }> = ({ accepted }) => (
  <span className={`verdict ${accepted ? 'accept' : 'reject'}`}>
    {accepted ? '✓ 接受' : '✗ 拒绝'}
  </span>
);

/** 跨三台机器的统一测试串面板 */
export const TestRunner: React.FC<TestRunnerProps> = ({
  input,
  onInputChange,
  onRun,
  loading,
  result,
  pos,
  onPosChange,
  disabled,
}) => {
  return (
    <section className="test-runner panel">
      <h2>⑥ 在三台机器上跑同一个测试串</h2>
      <div className="test-row">
        <input
          className="test-input"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRun();
          }}
          placeholder="输入测试串，例如 abb（可留空表示 ε）"
          disabled={disabled}
          spellCheck={false}
        />
        <button className="btn btn-build" onClick={onRun} disabled={loading || disabled}>
          {loading ? '模拟中…' : '▶ 运行'}
        </button>
      </div>

      {result && (
        <>
          <div className={`agree-banner ${result.agree ? 'ok' : 'mismatch'}`}>
            {result.agree
              ? '🔗 正确性主线：NFA、DFA、最小化 DFA 的结论完全一致'
              : '⚠ 三台机器结论不一致（不应发生，请检查构造算法！）'}
          </div>

          <div className="verdict-grid">
            <div className="verdict-cell">
              <span className="verdict-label">NFA</span>
              <Verdict accepted={result.nfa.accepted} />
            </div>
            <div className="verdict-cell">
              <span className="verdict-label">DFA</span>
              <Verdict accepted={result.dfa.accepted} />
            </div>
            <div className="verdict-cell">
              <span className="verdict-label">最小化 DFA</span>
              <Verdict accepted={result.min.accepted} />
            </div>
          </div>

          <div className="trace-slider">
            <span className="trace-title">逐字符回看（三台图中路径同步高亮）：</span>
            <input
              type="range"
              min={0}
              max={input.length}
              value={pos}
              onChange={(e) => onPosChange(Number(e.target.value))}
            />
            <span className="trace-pos">
              已读 {pos}/{input.length}
            </span>
          </div>
          <CharTrace input={input} pos={pos} />
        </>
      )}
    </section>
  );
};

/** 把测试串画成字符格子，已读部分着色 */
const CharTrace: React.FC<{ input: string; pos: number }> = ({ input, pos }) => {
  if (input.length === 0) {
    return (
      <div className="char-trace">
        <span className={`char-cell ${pos === 0 ? 'current' : ''}`}>ε</span>
      </div>
    );
  }
  return (
    <div className="char-trace">
      {input.split('').map((ch, i) => (
        <span key={i} className={`char-cell ${i < pos ? 'read' : ''} ${i === pos ? 'current' : ''}`}>
          {ch === ' ' ? '␠' : ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ch}
        </span>
      ))}
      {pos === input.length && <span className="end-marker">结束</span>}
    </div>
  );
};
