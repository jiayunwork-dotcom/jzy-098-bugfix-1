import type { CharRange, Label } from '../../../shared/types';

/**
 * 字母表的“同行为分区（signature partition）”。
 *
 * 字符类（含区间和取反）会把输入字符分成若干等价区域：在同一个区域里，
 * 所有 NFA 转移标签的取值都相同，因此子集构造只需为每个区域选一个代表字符，
 * 就能覆盖全部转移行为，而不必枚举整个 Unicode。
 *
 * 断点取每个标签区间的起点 lo 与终点之后 hi+1（正向集合在 lo 进入、hi+1 离开；
 * 取反集合恰好互补，但断点位置完全相同）。相邻断点之间即为一个区域。
 */

const MAX_CODE = 0x10ffff;

export interface Signature {
  /** 每个区域一个代表码点（取区域起点），升序 */
  reps: number[];
  /** 与 reps 对齐的区域区间，互不相交并覆盖整个标量值空间 */
  ranges: CharRange[];
  /** 区域区间 -> 下标（按下标在 ranges 中查找） */
  indexOfRep: Map<number, number>;
}

export function buildSignature(labels: Label[]): Signature {
  const boundaries = new Set<number>([0, MAX_CODE + 1]);

  for (const label of labels) {
    if (label.kind === 'eps') continue;
    for (const r of label.ranges) {
      boundaries.add(r.lo);
      if (r.hi + 1 <= MAX_CODE) boundaries.add(r.hi + 1);
    }
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const reps: number[] = [];
  const ranges: CharRange[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1] - 1;
    if (hi < lo) continue; // 相邻断点产生的空区域
    reps.push(lo);
    ranges.push({ lo, hi });
  }

  const indexOfRep = new Map<number, number>();
  reps.forEach((r, i) => indexOfRep.set(r, i));
  return { reps, ranges, indexOfRep };
}
