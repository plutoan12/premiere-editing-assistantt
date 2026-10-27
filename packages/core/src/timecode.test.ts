import { describe, expect, it } from "vitest";
import { FPS_23_976, FPS_24, FPS_25, FPS_29_97, FPS_59_94, TimeError, mediaTime, rational } from "./time.js";
import { formatTimecode, fromTimecode, parseTimecode, timecode, toTimecode } from "./timecode.js";

describe("Timecode", () => {
  it("is a display value: frames + frame rate + drop-frame flag, separate from MediaTime", () => {
    const tc = timecode(1800, FPS_29_97, true);
    expect(tc).toEqual({ frames: 1800, frameRate: { numerator: 30000, denominator: 1001 }, dropFrame: true });
    const mt = mediaTime(1800, FPS_29_97);
    expect(Object.keys(mt)).toEqual(["ticks", "timebase"]);
    expect("dropFrame" in mt).toBe(false);
  });

  it("only allows drop-frame on 29.97 and 59.94", () => {
    expect(() => timecode(0, FPS_24, true)).toThrow(TimeError);
    expect(() => timecode(0, FPS_23_976, true)).toThrow(TimeError);
    expect(() => timecode(0, FPS_25, true)).toThrow(TimeError);
    expect(timecode(0, FPS_59_94, true).dropFrame).toBe(true);
  });

  it("rejects negative frames", () => {
    expect(() => timecode(-1, FPS_24, false)).toThrow(TimeError);
  });
});

describe("toTimecode / fromTimecode", () => {
  it("round-trips drop-frame and non-drop-frame identity", () => {
    const mt = mediaTime(107892, FPS_29_97); // one hour of 29.97 DF = 107892 frames
    const df = toTimecode(mt, FPS_29_97, true);
    const ndf = toTimecode(mt, FPS_29_97, false);
    expect(df.dropFrame).toBe(true);
    expect(ndf.dropFrame).toBe(false);
    expect(df.frames).toBe(ndf.frames);
    expect(fromTimecode(df)).toEqual(mt);
    expect(fromTimecode(ndf)).toEqual(mt);
  });

  it("converts exactly across timebases and refuses inexact frame counts", () => {
    const oneSecondAt48k = mediaTime(48000, rational(48000, 1));
    expect(toTimecode(oneSecondAt48k, FPS_24, false).frames).toBe(24);
    expect(() => toTimecode(mediaTime(1, rational(48000, 1)), FPS_24, false)).toThrow(TimeError);
  });
});

describe("formatTimecode / parseTimecode", () => {
  it("formats non-drop-frame with colons", () => {
    expect(formatTimecode(timecode(0, FPS_24, false))).toBe("00:00:00:00");
    expect(formatTimecode(timecode(24 * 3600 + 24 * 60 * 2 + 24 * 3 + 4, FPS_24, false))).toBe("01:02:03:04");
    expect(formatTimecode(timecode(25 * 60 * 60 * 25, FPS_25, false))).toBe("25:00:00:00");
  });

  it("formats drop-frame with a semicolon and skips dropped frame numbers", () => {
    // 29.97 DF: frames 0 and 1 are dropped at the start of every minute except every tenth
    expect(formatTimecode(timecode(1800, FPS_29_97, true))).toBe("00:01:00;02");
    expect(formatTimecode(timecode(1799, FPS_29_97, true))).toBe("00:00:59;29");
    expect(formatTimecode(timecode(17982, FPS_29_97, true))).toBe("00:10:00;00");
    expect(formatTimecode(timecode(107892, FPS_29_97, true))).toBe("01:00:00;00");
    expect(formatTimecode(timecode(107892, FPS_29_97, false))).toBe("00:59:56:12");
    // 59.94 DF drops 4 frames per minute
    expect(formatTimecode(timecode(3600, FPS_59_94, true))).toBe("00:01:00;04");
    expect(formatTimecode(timecode(215784, FPS_59_94, true))).toBe("01:00:00;00");
  });

  it("parses what it formats for every frame in a long range", () => {
    for (const [rate, df] of [
      [FPS_29_97, true],
      [FPS_29_97, false],
      [FPS_59_94, true],
      [FPS_23_976, false],
      [FPS_24, false],
    ] as const) {
      for (let f = 0; f < 36_000; f += 7) {
        const tc = timecode(f, rate, df);
        expect(parseTimecode(formatTimecode(tc), rate, df)).toEqual(tc);
      }
      // around the hour boundary
      for (let f = 107_880; f < 107_900; f += 1) {
        const tc = timecode(f, rate, df);
        expect(parseTimecode(formatTimecode(tc), rate, df)).toEqual(tc);
      }
    }
  });

  it("rejects dropped frame numbers, out-of-range fields and separator mismatches", () => {
    expect(() => parseTimecode("00:01:00;00", FPS_29_97, true)).toThrow(TimeError);
    expect(() => parseTimecode("00:01:00;01", FPS_29_97, true)).toThrow(TimeError);
    expect(parseTimecode("00:10:00;00", FPS_29_97, true).frames).toBe(17982);
    expect(() => parseTimecode("00:00:00:30", FPS_29_97, false)).toThrow(TimeError);
    expect(() => parseTimecode("00:60:00:00", FPS_24, false)).toThrow(TimeError);
    expect(() => parseTimecode("00:00:00:00", FPS_29_97, true)).toThrow(TimeError);
    expect(() => parseTimecode("00:00:00;00", FPS_29_97, false)).toThrow(TimeError);
    expect(() => parseTimecode("garbage", FPS_24, false)).toThrow(TimeError);
  });
});
