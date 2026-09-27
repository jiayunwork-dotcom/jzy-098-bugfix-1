import type { CharRange, Label } from '@shared/types';

/** 码点 -> 可在边上显示的短文本 */
export function codeToText(code: number): string {
  switch (code) {
    case 9:
      return '\\t';
    case 10:
      return '\\n';
    case 13:
      return '\\r';
    case 32:
      return '␠';
    default: {
      const ch = String.fromCodePoint(code);
      if (code >= 33 && code <= 126) return ch;
      if (code > 126) return ch;
      return `\\x${code.toString(16).padStart(2, '0')}`;
    }
  }
}

function rangeToText(r: CharRange): string {
  if (r.lo === r.hi) return codeToText(r.lo);
  return `${codeToText(r.lo)}-${codeToText(r.hi)}`;
}

/** 区间集合 -> 边标签文本；区间过多时折叠，避免标签撑爆图面 */
export function rangesToText(ranges: CharRange[], maxParts = 6): string {
  const parts = ranges.map(rangeToText);
  if (parts.length <= maxParts) return parts.join(', ');
  return `${parts.slice(0, maxParts).join(', ')} …(+${parts.length - maxParts})`;
}

export function labelToText(label: Label): string {
  if (label.kind === 'eps') return 'ε';
  const body = rangesToText(label.ranges);
  return label.negated ? `非(${body})` : body;
}

export function isPrintableInput(code: number): boolean {
  return code >= 32 && code !== 127;
}
