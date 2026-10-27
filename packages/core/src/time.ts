/**
 * Exact time model.
 *
 * Canonical time is `MediaTime = { ticks, timebase }` where `timebase` is the
 * tick rate in ticks per second as a reduced rational. Seconds are never
 * stored as floating point. Cross-timebase arithmetic runs on BigInt so no
 * intermediate can exceed the 2^53 safe-integer range; every result that
 * leaves this module is checked to be a safe integer.
 */

export class TimeError extends Error {
  override readonly name = "TimeError";
}

/** Reduced rational with a positive denominator. */
export interface Rational {
  readonly numerator: number;
  readonly denominator: number;
}

/** Frames per second. */
export type FrameRate = Rational;

/** Canonical time: integer ticks at an explicit tick rate. */
export interface MediaTime {
  readonly ticks: number;
  readonly timebase: Rational;
}

/** Half-open or empty range `[start, end]` in one timebase with `end >= start`. */
export interface TimeRange {
  readonly start: MediaTime;
  readonly end: MediaTime;
}

export type RoundingMode = "floor" | "ceil" | "nearest";

export const MAX_SAFE_TICKS = Number.MAX_SAFE_INTEGER;

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TimeError(`${label} must be a safe integer, got ${String(value)}`);
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

export function rational(numerator: number, denominator: number): Rational {
  assertSafeInteger(numerator, "numerator");
  assertSafeInteger(denominator, "denominator");
  if (denominator === 0) {
    throw new TimeError("denominator must not be zero");
  }
  if (numerator === 0) {
    return { numerator: 0, denominator: 1 };
  }
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const g = gcd(numerator, denominator);
  return {
    numerator: (sign * Math.abs(numerator)) / g,
    denominator: Math.abs(denominator) / g,
  };
}

export function rationalEquals(a: Rational, b: Rational): boolean {
  const ra = rational(a.numerator, a.denominator);
  const rb = rational(b.numerator, b.denominator);
  return ra.numerator === rb.numerator && ra.denominator === rb.denominator;
}

function assertTimebase(timebase: Rational): Rational {
  const tb = rational(timebase.numerator, timebase.denominator);
  if (tb.numerator <= 0) {
    throw new TimeError("timebase must be a positive rate");
  }
  return tb;
}

export function mediaTime(ticks: number, timebase: Rational): MediaTime {
  assertSafeInteger(ticks, "ticks");
  return { ticks, timebase: assertTimebase(timebase) };
}

export function isSameTimebase(a: MediaTime, b: MediaTime): boolean {
  return rationalEquals(a.timebase, b.timebase);
}

/** Seconds of `t` as an exact fraction `[numerator, denominator]` in BigInt. */
function secondsFraction(t: MediaTime): [bigint, bigint] {
  return [BigInt(t.ticks) * BigInt(t.timebase.denominator), BigInt(t.timebase.numerator)];
}

export function compareMediaTime(a: MediaTime, b: MediaTime): -1 | 0 | 1 {
  if (isSameTimebase(a, b)) {
    return a.ticks < b.ticks ? -1 : a.ticks > b.ticks ? 1 : 0;
  }
  const [an, ad] = secondsFraction(a);
  const [bn, bd] = secondsFraction(b);
  const left = an * bd;
  const right = bn * ad;
  return left < right ? -1 : left > right ? 1 : 0;
}

function bigintToSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new TimeError(`${label} exceeds the safe-integer range`);
  }
  return Number(value);
}

/**
 * Re-express `t` in `timebase`. Exact by default: an inexact conversion throws
 * unless a rounding mode is given explicitly. Silent conversion is forbidden
 * by the platform spec.
 */
export function convertMediaTime(
  t: MediaTime,
  timebase: Rational,
  options: { readonly rounding?: RoundingMode } = {},
): MediaTime {
  const target = assertTimebase(timebase);
  if (rationalEquals(t.timebase, target)) {
    return mediaTime(t.ticks, target);
  }
  // newTicks = ticks * (srcDen / srcNum) * (dstNum / dstDen)
  const numer = BigInt(t.ticks) * BigInt(t.timebase.denominator) * BigInt(target.numerator);
  const denom = BigInt(t.timebase.numerator) * BigInt(target.denominator);
  let q = numer / denom; // truncates toward zero
  const r = numer % denom;
  if (r !== 0n) {
    const mode = options.rounding;
    if (mode === undefined) {
      throw new TimeError(
        `inexact conversion from ${t.ticks}@${t.timebase.numerator}/${t.timebase.denominator} to ${target.numerator}/${target.denominator}; pass an explicit rounding mode`,
      );
    }
    const negative = numer < 0n;
    if (mode === "floor") {
      if (negative) q -= 1n;
    } else if (mode === "ceil") {
      if (!negative) q += 1n;
    } else {
      const twiceRemainder = (r < 0n ? -r : r) * 2n;
      if (twiceRemainder >= denom) {
        q += negative ? -1n : 1n;
      }
    }
  }
  return mediaTime(bigintToSafeNumber(q, "converted ticks"), target);
}

export function validateTimeRange(range: TimeRange): TimeRange {
  const start = mediaTime(range.start.ticks, range.start.timebase);
  const end = mediaTime(range.end.ticks, range.end.timebase);
  if (!isSameTimebase(start, end)) {
    throw new TimeError("time range start and end must share one timebase");
  }
  if (end.ticks < start.ticks) {
    throw new TimeError("time range must not have a negative duration");
  }
  return { start, end };
}

export function timeRange(start: MediaTime, end: MediaTime): TimeRange {
  return validateTimeRange({ start, end });
}

export function durationTicks(range: TimeRange): number {
  return range.end.ticks - range.start.ticks;
}

export const FPS_23_976: FrameRate = rational(24000, 1001);
export const FPS_24: FrameRate = rational(24, 1);
export const FPS_25: FrameRate = rational(25, 1);
export const FPS_29_97: FrameRate = rational(30000, 1001);
export const FPS_30: FrameRate = rational(30, 1);
export const FPS_50: FrameRate = rational(50, 1);
export const FPS_59_94: FrameRate = rational(60000, 1001);
export const FPS_60: FrameRate = rational(60, 1);
