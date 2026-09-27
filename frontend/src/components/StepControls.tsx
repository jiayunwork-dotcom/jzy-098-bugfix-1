import React from 'react';

interface StepControlsProps {
  /** 总步数（最后一步为“完成”） */
  total: number;
  /** 当前步索引，-1 表示还没开始 */
  index: number;
  onChange: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onStart: () => void;
  onFinish: () => void;
  /** 单步按钮旁的阶段文案，例如“下一片段” */
  nextLabel?: string;
}

/** 逐步演示控制条：首步 / 上一步 / 滑块 / 下一步 / 跑完 */
export const StepControls: React.FC<StepControlsProps> = ({
  total,
  index,
  onChange,
  onPrev,
  onNext,
  onStart,
  onFinish,
  nextLabel = '下一步',
}) => {
  const disabled = total === 0;
  return (
    <div className="step-controls">
      <button className="btn" onClick={onStart} disabled={disabled || index <= 0} title="回到第一步">
        ⏮
      </button>
      <button className="btn" onClick={onPrev} disabled={disabled || index <= 0}>
        ◀ 上一步
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={Math.max(0, index)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="step-slider"
      />
      <button className="btn btn-primary" onClick={onNext} disabled={disabled || index >= total - 1}>
        {nextLabel} ▶
      </button>
      <button className="btn" onClick={onFinish} disabled={disabled || index >= total - 1} title="一键跑完">
        ⏭ 跑完
      </button>
      <span className="step-counter">
        {disabled ? '—' : `${Math.max(0, index) + 1} / ${total}`}
      </span>
    </div>
  );
};
