import { z } from "zod";
import { compareMediaTime, FrameRateSchema, MediaTimeSchema, TimeRangeSchema,
  type FrameRate, type MediaTime, type TimeRange } from "@pea/core";
import { GraphicsError, IdSchema } from "./contracts.js";

function safeBase(base: { numerator: number; denominator: number }) {
  return Number.isSafeInteger(base.numerator) && base.numerator > 0
    && Number.isSafeInteger(base.denominator) && base.denominator > 0;
}
export const GraphicsFrameRateSchema = FrameRateSchema.refine(f => safeBase(f.rate), "Unsafe frame rate");
export const GraphicsTimeSchema = MediaTimeSchema.refine(t => safeBase(t.timebase) && t.ticks >= 0n, "Invalid media time");
export const GraphicsRangeSchema = TimeRangeSchema.superRefine((range, ctx) => {
  if (!GraphicsTimeSchema.safeParse(range.start).success || !GraphicsTimeSchema.safeParse(range.duration).success || range.duration.ticks <= 0n)
    ctx.addIssue({ code: "custom", message: "Range needs nonnegative start and positive duration with safe rational timebases" });
});
export const ClipMappingSchema = z.object({
  mediaAssetId: IdSchema, sourceRange: GraphicsRangeSchema, destination: GraphicsTimeSchema, frameRate: GraphicsFrameRateSchema,
}).strict();
export type ClipMapping = z.infer<typeof ClipMappingSchema>;

type Fraction = { n: bigint; d: bigint };
const fraction = (time: MediaTime): Fraction => ({ n: time.ticks * BigInt(time.timebase.numerator), d: BigInt(time.timebase.denominator) });
const add = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const end = (range: TimeRange) => add(fraction(range.start), fraction(range.duration));
const less = (a: Fraction, b: Fraction) => a.n * b.d < b.n * a.d;
function asFrames(value: Fraction, frameRate: FrameRate): MediaTime {
  const n = value.n * BigInt(frameRate.rate.numerator);
  const d = value.d * BigInt(frameRate.rate.denominator);
  if (n < 0n || n % d !== 0n) throw new GraphicsError("SUBFRAME_TIME", "Time must lie exactly on a sequence frame");
  return { ticks: n / d, timebase: { numerator: frameRate.rate.denominator, denominator: frameRate.rate.numerator } };
}
export function assertFrameAligned(range: TimeRange, frameRate: FrameRate): void {
  GraphicsRangeSchema.parse(range); GraphicsFrameRateSchema.parse(frameRate);
  asFrames(fraction(range.start), frameRate); asFrames(fraction(range.duration), frameRate);
}
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  GraphicsRangeSchema.parse(a); GraphicsRangeSchema.parse(b);
  return less(fraction(a.start), end(b)) && less(fraction(b.start), end(a));
}
export function mapCaptionRange(segment: { mediaAssetId: string; range: TimeRange }, input: ClipMapping, sequenceFrameRate: FrameRate): TimeRange {
  const mapping = ClipMappingSchema.parse(input), frameRate = GraphicsFrameRateSchema.parse(sequenceFrameRate);
  const range = GraphicsRangeSchema.parse(segment.range);
  if (segment.mediaAssetId !== mapping.mediaAssetId) throw new GraphicsError("MEDIA_MISMATCH", "Caption and clip refer to different media");
  if (BigInt(mapping.frameRate.rate.numerator) * BigInt(frameRate.rate.denominator)
      !== BigInt(frameRate.rate.numerator) * BigInt(mapping.frameRate.rate.denominator)
      || mapping.frameRate.dropFrame !== frameRate.dropFrame)
    throw new GraphicsError("FRAME_RATE_MISMATCH", "Frame-rate conversion or drop-frame identity change requires an explicit upstream mapping");
  assertFrameAligned(mapping.sourceRange, frameRate);
  asFrames(fraction(mapping.destination), frameRate);
  assertFrameAligned(range, frameRate);
  if (compareMediaTime(range.start, mapping.sourceRange.start) < 0 || less(end(mapping.sourceRange), end(range)))
    throw new GraphicsError("OUTSIDE_CLIP", "Caption must be fully inside its source clip; word-aware trimming belongs upstream");
  const source = fraction(mapping.sourceRange.start);
  const offset = add(fraction(range.start), { n: -source.n, d: source.d });
  return { start: asFrames(add(fraction(mapping.destination), offset), frameRate), duration: asFrames(fraction(range.duration), frameRate) };
}
