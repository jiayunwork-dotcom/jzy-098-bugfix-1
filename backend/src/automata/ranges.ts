import type { CharRange } from '../../../shared/types';

/** 码点区间的通用小工具（自动机各模块共用） */

export function normalizeRanges(ranges: CharRange[]): CharRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out: CharRange[] = [{ ...sorted[0] }];
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (r.lo <= last.hi + 1) {
      last.hi = Math.max(last.hi, r.hi);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export function inRanges(ranges: CharRange[], code: number): boolean {
  // ranges 已排序且互不相交，二分查找
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (code < r.lo) hi = mid - 1;
    else if (code > r.hi) lo = mid + 1;
    else return true;
  }
  return false;
}

export const MAX_CODE = 0x10ffff;

export function rangeSize(r: CharRange): number {
  return r.hi - r.lo + 1;
}
