import React, { useState } from 'react';
import type { BuildError } from '@shared/types';
import type { Example } from '../api';

interface RegexInputProps {
  pattern: string;
  onPatternChange: (p: string) => void;
  onBuild: () => void;
  loading: boolean;
  error: BuildError | null;
  examples: Example[];
}

export const RegexInput: React.FC<RegexInputProps> = ({
  pattern,
  onPatternChange,
  onBuild,
  loading,
  error,
  examples,
}) => {
  const [showExamples, setShowExamples] = useState(true);

  // 出错时高亮从 position 到 endPosition 的文本片段
  const errStart = error?.position ?? 0;
  const errEnd = error?.endPosition ?? errStart + 1;
  const before = pattern.slice(0, errStart);
  const marked = error ? pattern.slice(errStart, Math.max(errEnd, errStart + 1)) : '';
  const after = error ? pattern.slice(Math.max(errEnd, errStart + 1)) : '';

  return (
    <section className="regex-input panel">
      <h2>① 输入正则表达式</h2>
      <p className="hint">
        支持连接（直接并列）、选择 <code>|</code>、闭包 <code>*</code>、正闭包{' '}
        <code>+</code>、可选 <code>?</code>、括号 <code>()</code> 与字符类{' '}
        <code>[a-z]</code>、<code>[^"]</code>、<code>.</code>、<code>\d \w \s</code>。
      </p>

      <textarea
        className="pattern-box"
        value={pattern}
        onChange={(e) => onPatternChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onBuild();
        }}
        rows={2}
        spellCheck={false}
        placeholder="例如 (a|b)*abb"
      />

      {error && (
        <div className="error-card" role="alert">
          <div className="error-title">⚠ 正则有问题：{error.message}</div>
          <pre className="error-preview">
            {before}
            <mark>{marked || ' '}</mark>
            {after}
            <span className="error-pointer">{' '.repeat(Math.max(0, errStart))}↑ 第 {errStart + 1} 个字符附近</span>
          </pre>
        </div>
      )}

      <div className="build-row">
        <button className="btn btn-build" onClick={onBuild} disabled={loading}>
          {loading ? '构造中…' : '🔨 构造'}
        </button>
        <span className="kbd-hint">Ctrl/⌘ + Enter</span>
      </div>

      <div className="examples">
        <button className="link-btn" onClick={() => setShowExamples((v) => !v)}>
          {showExamples ? '▾' : '▸'} 内置示例
        </button>
        {showExamples && (
          <div className="example-grid">
            {examples.map((ex) => (
              <button
                key={ex.id}
                className="example-chip"
                title={ex.note}
                onClick={() => {
                  onPatternChange(ex.pattern);
                }}
              >
                <span className="example-name">{ex.name}</span>
                <code className="example-pattern">{ex.pattern}</code>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
