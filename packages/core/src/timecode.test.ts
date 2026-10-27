import { describe, expect, it } from "vitest";
import {
  TimecodeError,
  TimecodeSchema,
  formatTimecode,
  fromTimecode,
  isDropFrameCapable,
  parseTimecode,
  timecode,
  toTimecode,
  type TimecodeFormat,
} from "./timecode.js";
import type { MediaTime } from "./time.js";

const fps24: TimecodeFormat = { rate: { numerator: 24, denominator: 1 }, dropFrame: false };
const fps25: TimecodeFormat = { rate: { numerator: 25, denominator: 1 }, dropFrame: false };
const fps23976: TimecodeFormat = { rate: { numerator: 24000, denominator: 1001 }, dropFrame: false };
const ndf2997: TimecodeFormat = { rate: { numerator: 30000, denominator: 1001 }, dropFrame: false };
const df2997: TimecodeFormat = { rate: { numerator: 30000, denominator: 1001 }, dropFrame: true };
const df5994: TimecodeFormat = { rate: { numerator: 60000, denominator: 1001 }, dropFrame: true };

describe("Timecode", () => {
  it("is a display value: frames plus a timecode format; MediaTime carries no drop-frame flag", () => {
    const tc = timecode(1800, df2997);
    expect(TimecodeSchema.parse(tc)).toEqual({ frames: 1800, format: df2997 });
    const mt: MediaTime = fromTimecode(tc);
    expect(Object.keys(mt).sort()).toEqual(["ticks", "timebase"]);
    expect(mt).toEqual({ ticks: 1800n, timebase: { numerator: 1001, denominator: 30000 } });
  });

  it("only allows drop-frame on 29.97 and 59.94", () => {
    expect(isDropFrameCapable(df2997.rate)).toBe(true);
    expect(isDropFrameCapable(df5994.rate)).toBe(true);
    expect(isDropFrameCapable(fps23976.rate)).toBe(false);
    expect(() => timecode(0, { ...fps24, dropFrame: true })).toThrow(TimecodeError);
    expect(() => timecode(0, { ...fps23976, dropFrame: true })).toThrow(TimecodeError);
    expect(TimecodeSchema.safeParse({ frames: 0, format: { ...fps25, dropFrame: true } }).success).toBe(false);
  });

  it("rejects negative or fractional frames", () => {
    expect(() => timecode(-1, fps24)).toThrow(TimecodeError);
    expect(() => timecode(1.5, fps24)).toThrow(TimecodeError);
  });
});

describe("toTimecode / fromTimecode", () => {
  it("round-trips drop-frame and non-drop-frame identity on the same underlying time", () => {
    const mt: MediaTime = { ticks: 107892n, timebase: { numerator: 1001, denominator: 30000 } };
    const df = toTimecode(mt, df2997);
    const ndf = toTimecode(mt, ndf2997);
    expect(df.frames).toBe(107892);
    expect(ndf.frames).toBe(107892);
    expect(df.format.dropFrame).toBe(true);
    expect(ndf.format.dropFrame).toBe(false);
    expect(fromTimecode(df)).toEqual(mt);
    expect(fromTimecode(ndf)).toEqual(mt);
  });

  it("converts exactly from other timebases and refuses inexact or negative frame counts", () => {
    const oneSecondAt48k: MediaTime = { ticks: 48000n, timebase: { numerator: 1, denominator: 48000 } };
    expect(toTimecode(oneSecondAt48k, fps24).frames).toBe(24);
    expect(toTimecode({ ticks: 2004002n, timebase: { numerator: 1, denominator: 48000 } }, fps23976).frames).toBe(1001);
    expect(() => toTimecode({ ticks: 1n, timebase: { numerator: 1, denominator: 48000 } }, fps24)).toThrow(TimecodeError);
    expect(() => toTimecode({ ticks: -24n, timebase: { numerator: 1, denominator: 24 } }, fps24)).toThrow(TimecodeError);
  });
});

describe("formatTimecode / parseTimecode", () => {
  it("formats non-drop-frame with colons and does not cap hours", () => {
    expect(formatTimecode(timecode(0, fps24))).toBe("00:00:00:00");
    expect(formatTimecode(timecode(24 * 3600 + 24 * 60 * 2 + 24 * 3 + 4, fps24))).toBe("01:02:03:04");
    expect(formatTimecode(timecode(25 * 60 * 60 * 25, fps25))).toBe("25:00:00:00");
  });

  it("formats drop-frame with a semicolon and skips dropped frame numbers", () => {
    expect(formatTimecode(timecode(1800, df2997))).toBe("00:01:00;02");
    expect(formatTimecode(timecode(1799, df2997))).toBe("00:00:59;29");
    expect(formatTimecode(timecode(17982, df2997))).toBe("00:10:00;00");
    expect(formatTimecode(timecode(107892, df2997))).toBe("01:00:00;00");
    expect(formatTimecode(timecode(107892, ndf2997))).toBe("00:59:56:12");
    expect(formatTimecode(timecode(3600, df5994))).toBe("00:01:00;04");
    expect(formatTimecode(timecode(215784, df5994))).toBe("01:00:00;00");
  });

  it("parses what it formats for every frame in a long range", () => {
    for (const format of [df2997, ndf2997, df5994, fps23976, fps24]) {
      for (let f = 0; f < 36_000; f += 7) {
        const tc = timecode(f, format);
        expect(parseTimecode(formatTimecode(tc), format)).toEqual(tc);
      }
      for (let f = 107_880; f < 107_900; f += 1) {
        const tc = timecode(f, format);
        expect(parseTimecode(formatTimecode(tc), format)).toEqual(tc);
      }
    }
  });

  it("agrees with the sync engine's label convention for 29.97 DF", () => {
    // 01:00:00;00 DF is frame 107892; 01:00:00:00 NDF is frame 108000
    expect(parseTimecode("01:00:00;00", df2997).frames).toBe(107892);
    expect(parseTimecode("01:00:00:00", ndf2997).frames).toBe(108000);
  });

  it("rejects dropped frame numbers, out-of-range fields and separator mismatches", () => {
    expect(() => parseTimecode("00:01:00;00", df2997)).toThrow(TimecodeError);
    expect(() => parseTimecode("00:01:00;01", df2997)).toThrow(TimecodeError);
    expect(parseTimecode("00:10:00;00", df2997).frames).toBe(17982);
    expect(() => parseTimecode("00:00:00:30", ndf2997)).toThrow(TimecodeError);
    expect(() => parseTimecode("00:60:00:00", fps24)).toThrow(TimecodeError);
    expect(() => parseTimecode("00:00:00:00", df2997)).toThrow(TimecodeError);
    expect(() => parseTimecode("00:00:00;00", ndf2997)).toThrow(TimecodeError);
    expect(() => parseTimecode("garbage", fps24)).toThrow(TimecodeError);
  });
});
