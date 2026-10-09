import { z } from "zod";

export const RationalSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});
export type Rational = z.infer<typeof RationalSchema>;
export const FrameRateSchema = z.object({
  rate: RationalSchema,
  dropFrame: z.boolean().default(false),
});
export type FrameRate = z.infer<typeof FrameRateSchema>;
export const MediaTimeSchema = z.object({
  ticks: z.bigint(),
  timebase: RationalSchema,
});
export type MediaTime = z.infer<typeof MediaTimeSchema>;
export const TimeRangeSchema = z.object({
  start: MediaTimeSchema,
  duration: MediaTimeSchema,
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

const cross = (a: MediaTime, b: MediaTime) =>
  a.ticks * BigInt(a.timebase.numerator) * BigInt(b.timebase.denominator) -
  b.ticks * BigInt(b.timebase.numerator) * BigInt(a.timebase.denominator);
export function compareMediaTime(a: MediaTime, b: MediaTime) {
  const v = cross(a, b);
  return v < 0n ? -1 : v > 0n ? 1 : 0;
}
export function validateTimeRange(range: TimeRange) {
  TimeRangeSchema.parse(range);
  if (range.duration.ticks < 0n)
    throw new Error("duration must be non-negative");
  return range;
}

/** Exact rational addition, using the same cross-product approach as Sync. */
export function addMediaTime(a: MediaTime, b: MediaTime): MediaTime {
  MediaTimeSchema.parse(a);
  MediaTimeSchema.parse(b);
  const ad = BigInt(a.timebase.denominator),
    bd = BigInt(b.timebase.denominator);
  let n =
    a.ticks * BigInt(a.timebase.numerator) * bd +
    b.ticks * BigInt(b.timebase.numerator) * ad;
  let d = ad * bd;
  let x = n < 0n ? -n : n,
    y = d;
  while (y !== 0n) [x, y] = [y, x % y];
  n /= x;
  d /= x;
  if (d > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("combined timebase exceeds safe denominator");
  return { ticks: n, timebase: { numerator: 1, denominator: Number(d) } };
}

/** Organizer source ranges must be positive and fully contained in the source. */
export function validateBoundedTimeRange(
  range: TimeRange,
  duration: MediaTime,
): TimeRange {
  TimeRangeSchema.parse(range);
  MediaTimeSchema.parse(duration);
  if (
    range.start.ticks < 0n ||
    range.duration.ticks <= 0n ||
    duration.ticks <= 0n ||
    compareMediaTime(addMediaTime(range.start, range.duration), duration) > 0
  ) {
    throw new RangeError("source range is outside media duration");
  }
  return range;
}
