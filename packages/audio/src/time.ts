import type { ClipReference, MediaTime, Rational, TimeRange } from "@pea/core";

export type Rounding = "exact" | "floor" | "ceil" | "nearest";

export function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}

export function validateTime(time: MediaTime): void {
  if (typeof time.ticks !== "bigint") throw new Error("time ticks must be bigint");
  positiveInteger(time.timebase.numerator, "timebase numerator");
  positiveInteger(time.timebase.denominator, "timebase denominator");
}

export function validateRange(range: TimeRange): void {
  validateTime(range.start);
  validateTime(range.duration);
  if (range.start.ticks < 0n || range.duration.ticks <= 0n) throw new Error("range must have nonnegative start and positive duration");
}

export function sampleTime(sample: bigint, sampleRate: number): MediaTime {
  positiveInteger(sampleRate, "sample rate");
  if (typeof sample !== "bigint") throw new Error("sample must be bigint");
  return { ticks: sample, timebase: { numerator: 1, denominator: sampleRate } };
}

export function timeToSamples(time: MediaTime, sampleRate: number, rounding: Rounding = "exact"): bigint {
  validateTime(time);
  positiveInteger(sampleRate, "sample rate");
  if (!["exact", "floor", "ceil", "nearest"].includes(rounding)) throw new Error("invalid rounding policy");
  const numerator = time.ticks * BigInt(time.timebase.numerator) * BigInt(sampleRate);
  const denominator = BigInt(time.timebase.denominator);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  if (rounding === "exact") throw new Error("fractional sample requires an explicit rounding policy");
  if (rounding === "floor") return quotient - (remainder < 0n ? 1n : 0n);
  if (rounding === "ceil") return quotient + (remainder > 0n ? 1n : 0n);
  return quotient + (abs(remainder) * 2n >= denominator ? (remainder < 0n ? -1n : 1n) : 0n);
}

const abs = (n: bigint) => n < 0n ? -n : n;
function gcd(a: bigint, b: bigint): bigint { while (b !== 0n) [a, b] = [b, a % b]; return abs(a); }
type Fraction = [bigint, bigint];
function fraction(time: MediaTime): Fraction { validateTime(time); return [time.ticks * BigInt(time.timebase.numerator), BigInt(time.timebase.denominator)]; }
function add(a: Fraction, b: Fraction): Fraction { return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]]; }
function canonical([n, d]: Fraction): MediaTime {
  const factor = gcd(n, d);
  n /= factor; d /= factor;
  if (d > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("timebase denominator exceeds safe integer range");
  return { ticks: n, timebase: { numerator: 1, denominator: Number(d) } };
}

export function addTime(a: MediaTime, b: MediaTime): MediaTime { return canonical(add(fraction(a), fraction(b))); }

/** Maps source timestamps in the clip's half-open range. Does not round to video frames. */
export function sourceToSequenceTime(source: MediaTime, clip: ClipReference, destination: MediaTime, speed: Rational = { numerator: 1, denominator: 1 }): MediaTime {
  validateRange(clip.sourceRange);
  validateTime(destination);
  if (destination.ticks < 0n) throw new Error("destination must be nonnegative");
  positiveInteger(speed.numerator, "speed numerator");
  positiveInteger(speed.denominator, "speed denominator");
  const [sn, sd] = fraction(clip.sourceRange.start);
  const delta = add(fraction(source), [-sn, sd]);
  const duration = fraction(clip.sourceRange.duration);
  if (delta[0] < 0n || delta[0] * duration[1] >= duration[0] * delta[1]) throw new Error("source time is outside clip range");
  return canonical(add(fraction(destination), [delta[0] * BigInt(speed.denominator), delta[1] * BigInt(speed.numerator)]));
}
