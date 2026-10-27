/**
 * Timecode is a *display* value: a frame count plus the timecode format
 * (frame rate and drop-frame flag) that decides how the count is labelled.
 * It is deliberately separate from `MediaTime`: drop-frame never changes the
 * underlying time, only the label. `TimecodeFormat` is the existing
 * `FrameRate` shape (`{ rate, dropFrame }`), which is what media probes and
 * sync evidence already carry.
 *
 * Conventions follow `time.ts`: a timebase is the tick duration in seconds,
 * so one frame at 29.97 fps has timebase 1001/30000.
 */
import { z } from "zod";
import { FrameRateSchema, type FrameRate, type MediaTime, type Rational } from "./time.js";

export type TimecodeFormat = FrameRate;

export class TimecodeError extends Error {
  override readonly name = "TimecodeError";
}

export function isDropFrameCapable(rate: Rational): boolean {
  const g = gcd(rate.numerator, rate.denominator);
  const n = rate.numerator / g;
  const d = rate.denominator / g;
  return d === 1001 && (n === 30000 || n === 60000);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

export const TimecodeFormatSchema = FrameRateSchema.refine((f) => !f.dropFrame || isDropFrameCapable(f.rate), "drop-frame is only defined for 30000/1001 and 60000/1001");

export const TimecodeSchema = z.object({
  frames: z.number().int().nonnegative(),
  format: TimecodeFormatSchema,
});
export type Timecode = z.infer<typeof TimecodeSchema>;

export function timecode(frames: number, format: TimecodeFormat): Timecode {
  if (!Number.isSafeInteger(frames) || frames < 0) {
    throw new TimecodeError(`timecode frames must be a non-negative safe integer, got ${String(frames)}`);
  }
  const parsed = TimecodeFormatSchema.safeParse(format);
  if (!parsed.success) {
    throw new TimecodeError(`invalid timecode format ${format.rate.numerator}/${format.rate.denominator} dropFrame=${String(format.dropFrame)}`);
  }
  return { frames, format: parsed.data };
}

/** Tick duration of one frame in `format`, in the `time.ts` convention. */
export function frameTimebase(format: TimecodeFormat): Rational {
  return { numerator: format.rate.denominator, denominator: format.rate.numerator };
}

/** Exact conversion; throws when `t` is negative or not on a frame boundary of `format`. */
export function toTimecode(t: MediaTime, format: TimecodeFormat): Timecode {
  // frames = ticks * (tb.num / tb.den) seconds * (rate.num / rate.den) frames per second
  const numer = t.ticks * BigInt(t.timebase.numerator) * BigInt(format.rate.numerator);
  const denom = BigInt(t.timebase.denominator) * BigInt(format.rate.denominator);
  if (numer % denom !== 0n) {
    throw new TimecodeError(`media time ${t.ticks}@${t.timebase.numerator}/${t.timebase.denominator} is not on a frame boundary of ${format.rate.numerator}/${format.rate.denominator}`);
  }
  const frames = numer / denom;
  if (frames < 0n) throw new TimecodeError("timecode cannot represent negative time");
  if (frames > BigInt(Number.MAX_SAFE_INTEGER)) throw new TimecodeError("frame count exceeds the safe-integer range");
  return timecode(Number(frames), format);
}

export function fromTimecode(tc: Timecode): MediaTime {
  return { ticks: BigInt(tc.frames), timebase: frameTimebase(tc.format) };
}

/** Integer frames per nominal second used for labelling (24 for 23.976, 30 for 29.97). */
function nominalRate(rate: Rational): number {
  return Math.ceil(rate.numerator / rate.denominator);
}

/** Frames dropped per minute: 2 at 30 fps nominal, 4 at 60 fps nominal. */
function dropCount(nominal: number): number {
  return nominal / 15;
}

const pad = (n: number): string => n.toString().padStart(2, "0");

export function formatTimecode(tc: Timecode): string {
  const nominal = nominalRate(tc.format.rate);
  let f = tc.frames;
  if (tc.format.dropFrame) {
    const drop = dropCount(nominal);
    const framesPerMinute = nominal * 60 - drop;
    const framesPerTenMinutes = framesPerMinute * 10 + drop;
    const d = Math.floor(f / framesPerTenMinutes);
    const m = f % framesPerTenMinutes;
    f += drop * 9 * d;
    if (m > drop) f += drop * Math.floor((m - drop) / framesPerMinute);
  }
  const ff = f % nominal;
  const totalSeconds = Math.floor(f / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${tc.format.dropFrame ? ";" : ":"}${pad(ff)}`;
}

const TIMECODE_PATTERN = /^(\d{2,}):(\d{2}):(\d{2})([:;])(\d{2})$/;

export function parseTimecode(label: string, format: TimecodeFormat): Timecode {
  const match = TIMECODE_PATTERN.exec(label);
  if (match === null) throw new TimecodeError(`invalid timecode "${label}"`);
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  const sep = match[4];
  const ff = Number(match[5]);
  const expectedSep = format.dropFrame ? ";" : ":";
  if (sep !== expectedSep) {
    throw new TimecodeError(`timecode "${label}" uses "${sep}" but ${format.dropFrame ? "drop-frame" : "non-drop-frame"} expects "${expectedSep}"`);
  }
  const nominal = nominalRate(format.rate);
  if (mm >= 60 || ss >= 60 || ff >= nominal) {
    throw new TimecodeError(`timecode "${label}" has a field out of range for ${format.rate.numerator}/${format.rate.denominator}`);
  }
  let frames = nominal * (hh * 3600 + mm * 60 + ss) + ff;
  if (format.dropFrame) {
    if (!isDropFrameCapable(format.rate)) {
      throw new TimecodeError(`drop-frame is only defined for 30000/1001 and 60000/1001, got ${format.rate.numerator}/${format.rate.denominator}`);
    }
    const drop = dropCount(nominal);
    if (mm % 10 !== 0 && ss === 0 && ff < drop) throw new TimecodeError(`timecode "${label}" names a dropped frame number`);
    const totalMinutes = hh * 60 + mm;
    frames -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return timecode(frames, format);
}
