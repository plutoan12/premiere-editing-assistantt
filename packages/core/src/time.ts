import { z } from "zod";

export const RationalSchema = z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() });
export type Rational = z.infer<typeof RationalSchema>;
export const FrameRateSchema = z.object({ rate: RationalSchema, dropFrame: z.boolean().default(false) });
export type FrameRate = z.infer<typeof FrameRateSchema>;
export const MediaTimeSchema = z.object({ ticks: z.bigint(), timebase: RationalSchema });
export type MediaTime = z.infer<typeof MediaTimeSchema>;
export const TimeRangeSchema = z.object({ start: MediaTimeSchema, duration: MediaTimeSchema });
export type TimeRange = z.infer<typeof TimeRangeSchema>;

const cross=(a:MediaTime,b:MediaTime)=>a.ticks*BigInt(a.timebase.numerator)*BigInt(b.timebase.denominator)-b.ticks*BigInt(b.timebase.numerator)*BigInt(a.timebase.denominator);
export function compareMediaTime(a:MediaTime,b:MediaTime){ const v=cross(a,b); return v<0n?-1:v>0n?1:0; }
export function validateTimeRange(range:TimeRange){ TimeRangeSchema.parse(range); if(range.duration.ticks<0n) throw new Error("duration must be non-negative"); return range; }
