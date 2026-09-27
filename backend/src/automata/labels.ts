import type { CharRange, Label } from '../../../shared/types';

export const EPS_LABEL: Label = { kind: 'eps' };

export function setLabel(ranges: CharRange[], negated = false): Label {
  return { kind: 'set', ranges, negated };
}

/** 判断标签是否接受某个码点 */
export function labelAccepts(label: Label, code: number): boolean {
  if (label.kind === 'eps') return false;
  const hit = label.ranges.some((r) => code >= r.lo && code <= r.hi);
  return label.negated ? !hit : hit;
}

/** 标签是否匹配单个确定码点（用于子集构造时枚举字母表） */
export function labelMatchesSingle(label: Label, code: number): boolean {
  return labelAccepts(label, code);
}

/* ---------------- 标签的可读渲染（供后端说明文字用） ---------------- */

function cpToText(code: number): string {
  switch (code) {
    case 9:
      return '\\t';
    case 10:
      return '\\n';
    case 13:
      return '\\r';
    case 32:
      return '空格';
    default:
      return String.fromCodePoint(code);
  }
}

function rangeToText(r: CharRange): string {
  if (r.lo === r.hi) return cpToText(r.lo);
  return `${cpToText(r.lo)}-${cpToText(r.hi)}`;
}

export function labelToText(label: Label): string {
  if (label.kind === 'eps') return 'ε';
  const body = label.ranges.map(rangeToText).join(', ');
  return label.negated ? `非(${body})` : body;
}
