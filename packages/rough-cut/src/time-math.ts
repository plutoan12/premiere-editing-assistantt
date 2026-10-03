import type { MediaTime, Rational, TimeRange } from '@pea/core';
export type Fraction = readonly [bigint, bigint];
export type Interval = readonly [bigint, bigint];
export function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be non-empty`);
}
export function positiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}
export function validateRational(value: Rational, label: string): void {
  if (!value || typeof value !== 'object') throw new Error(`${label} must be a rational`);
  positiveInteger(value.numerator, `${label}.numerator`);
  positiveInteger(value.denominator, `${label}.denominator`);
}
export function fraction(time: MediaTime, label: string): Fraction {
  if (!time || typeof time.ticks !== 'bigint') throw new Error(`${label}.ticks must be bigint`);
  validateRational(time.timebase, `${label}.timebase`);
  if (time.ticks < 0n) throw new Error(`${label} must be non-negative`);
  return [time.ticks * BigInt(time.timebase.numerator), BigInt(time.timebase.denominator)];
}
export function bounds(range: TimeRange, label: string): readonly [Fraction, Fraction] {
  if (!range) throw new Error(`${label} must be a range`);
  const start = fraction(range.start, `${label}.start`);
  if (range.duration && typeof range.duration.ticks === 'bigint' && range.duration.ticks <= 0n) throw new Error(`${label}.duration must be positive`);
  const duration = fraction(range.duration, `${label}.duration`);
  if (duration[0] <= 0n) throw new Error(`${label}.duration must be positive`);
  return [start, [start[0] * duration[1] + duration[0] * start[1], start[1] * duration[1]]];
}
export function compare(a: Fraction, b: Fraction): number {
  const delta = a[0] * b[1] - b[0] * a[1];
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
export function quantize(value: Fraction, quantum: Rational, mode: 'floor' | 'ceil' | 'exact', label: string): bigint {
  const n = value[0] * BigInt(quantum.denominator);
  const d = value[1] * BigInt(quantum.numerator);
  const q = n / d;
  const r = n % d;
  if (mode === 'exact' && r !== 0n) throw new Error(`${label} is not frame-aligned / not on sample grid`);
  return mode === 'ceil' && r !== 0n ? q + 1n : q;
}
export function mediaTime(ticks: bigint, timebase: Rational): MediaTime { return { ticks, timebase: { ...timebase } }; }
export function mediaRange(interval: Interval, timebase: Rational): TimeRange {
  return { start: mediaTime(interval[0], timebase), duration: mediaTime(interval[1] - interval[0], timebase) };
}
export function union(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter(([s,e])=>s<e).map(([s,e])=>[s,e] as Interval).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const output: Interval[] = [];
  for (const current of sorted) {
    const last = output.at(-1);
    if (last && current[0] <= last[1]) output[output.length-1] = [last[0], current[1]>last[1]?current[1]:last[1]];
    else output.push(current);
  }
  return output;
}
/** Inputs must be disjoint, sorted unions. Never mutate the caller's ranges. */
export function subtract(ranges: readonly Interval[], blockers: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  let first = 0;
  for (const [start,end] of ranges) {
    let cursor = start;
    while (first < blockers.length && blockers[first][1] <= start) first++;
    for (let i=first; i<blockers.length && blockers[i][0]<end; i++) {
      const [bs,be] = blockers[i];
      if (bs > cursor) result.push([cursor, bs < end ? bs : end]);
      if (be > cursor) cursor = be;
      if (cursor >= end) break;
    }
    if (cursor < end) result.push([cursor,end]);
  }
  return result;
}
