/**
 * Timecode is a *display* value: a frame count at a frame rate plus the
 * drop-frame flag that decides how that count is labelled. It is deliberately
 * separate from `MediaTime`; drop-frame never changes the underlying time.
 */
import { TimeError, convertMediaTime, mediaTime, rational, type FrameRate, type MediaTime } from "./time.js";

export interface Timecode {
  readonly frames: number;
  readonly frameRate: FrameRate;
  readonly dropFrame: boolean;
}

export function isDropFrameCapable(frameRate: FrameRate): boolean {
  const r = rational(frameRate.numerator, frameRate.denominator);
  return r.denominator === 1001 && (r.numerator === 30000 || r.numerator === 60000);
}

export function timecode(frames: number, frameRate: FrameRate, dropFrame: boolean): Timecode {
  if (!Number.isSafeInteger(frames) || frames < 0) {
    throw new TimeError(`timecode frames must be a non-negative safe integer, got ${String(frames)}`);
  }
  const rate = rational(frameRate.numerator, frameRate.denominator);
  if (rate.numerator <= 0) {
    throw new TimeError("frame rate must be positive");
  }
  if (dropFrame && !isDropFrameCapable(rate)) {
    throw new TimeError(`drop-frame is only defined for 30000/1001 and 60000/1001, got ${rate.numerator}/${rate.denominator}`);
  }
  return { frames, frameRate: rate, dropFrame };
}

/** Exact conversion; throws when `t` is not on a frame boundary of `frameRate`. */
export function toTimecode(t: MediaTime, frameRate: FrameRate, dropFrame: boolean): Timecode {
  const frames = convertMediaTime(t, frameRate).ticks;
  return timecode(frames, frameRate, dropFrame);
}

export function fromTimecode(tc: Timecode): MediaTime {
  return mediaTime(tc.frames, tc.frameRate);
}

/** Integer frame count per nominal second used for labelling (24 for 23.976, 30 for 29.97). */
function nominalRate(frameRate: FrameRate): number {
  return Math.ceil(frameRate.numerator / frameRate.denominator);
}

function dropCount(nominal: number): number {
  // 2 frames per minute at 30 fps nominal, 4 at 60 fps nominal.
  return nominal / 15;
}

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, "0");
}

export function formatTimecode(tc: Timecode): string {
  const nominal = nominalRate(tc.frameRate);
  let f = tc.frames;
  if (tc.dropFrame) {
    const drop = dropCount(nominal);
    const framesPerMinute = nominal * 60 - drop;
    const framesPerTenMinutes = framesPerMinute * 10 + drop;
    const d = Math.floor(f / framesPerTenMinutes);
    const m = f % framesPerTenMinutes;
    f += drop * 9 * d;
    if (m > drop) {
      f += drop * Math.floor((m - drop) / framesPerMinute);
    }
  }
  const ff = f % nominal;
  const totalSeconds = Math.floor(f / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const sep = tc.dropFrame ? ";" : ":";
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ff)}`;
}

const TIMECODE_PATTERN = /^(\d{2,}):(\d{2}):(\d{2})([:;])(\d{2})$/;

export function parseTimecode(text: string, frameRate: FrameRate, dropFrame: boolean): Timecode {
  const match = TIMECODE_PATTERN.exec(text);
  if (match === null) {
    throw new TimeError(`invalid timecode "${text}"`);
  }
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  const sep = match[4];
  const ff = Number(match[5]);
  const expectedSep = dropFrame ? ";" : ":";
  if (sep !== expectedSep) {
    throw new TimeError(`timecode "${text}" uses "${sep}" but ${dropFrame ? "drop-frame" : "non-drop-frame"} expects "${expectedSep}"`);
  }
  const rate = rational(frameRate.numerator, frameRate.denominator);
  const nominal = nominalRate(rate);
  if (mm >= 60 || ss >= 60 || ff >= nominal) {
    throw new TimeError(`timecode "${text}" has a field out of range for ${rate.numerator}/${rate.denominator}`);
  }
  let frames = nominal * (hh * 3600 + mm * 60 + ss) + ff;
  if (dropFrame) {
    if (!isDropFrameCapable(rate)) {
      throw new TimeError(`drop-frame is only defined for 30000/1001 and 60000/1001, got ${rate.numerator}/${rate.denominator}`);
    }
    const drop = dropCount(nominal);
    if (mm % 10 !== 0 && ss === 0 && ff < drop) {
      throw new TimeError(`timecode "${text}" names a dropped frame number`);
    }
    const totalMinutes = hh * 60 + mm;
    frames -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return timecode(frames, rate, dropFrame);
}
