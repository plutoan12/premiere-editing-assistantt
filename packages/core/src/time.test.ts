import { describe, expect, it } from "vitest";
import {
  FPS_23_976,
  FPS_24,
  FPS_29_97,
  MAX_SAFE_TICKS,
  TimeError,
  compareMediaTime,
  convertMediaTime,
  durationTicks,
  isSameTimebase,
  mediaTime,
  rational,
  rationalEquals,
  timeRange,
  validateTimeRange,
} from "./time.js";

describe("rational", () => {
  it("reduces to lowest terms and normalizes sign", () => {
    expect(rational(48000, 2)).toEqual({ numerator: 24000, denominator: 1 });
    expect(rational(-24, -1)).toEqual({ numerator: 24, denominator: 1 });
    expect(rational(0, 5)).toEqual({ numerator: 0, denominator: 1 });
  });

  it("keeps NTSC rates exact", () => {
    expect(FPS_23_976).toEqual({ numerator: 24000, denominator: 1001 });
    expect(FPS_29_97).toEqual({ numerator: 30000, denominator: 1001 });
    expect(FPS_24).toEqual({ numerator: 24, denominator: 1 });
    expect(rationalEquals(rational(48000, 2002), FPS_23_976)).toBe(true);
  });

  it("rejects non-integers, zero denominators and unsafe integers", () => {
    expect(() => rational(23.976, 1)).toThrow(TimeError);
    expect(() => rational(24, 0)).toThrow(TimeError);
    expect(() => rational(Number.MAX_SAFE_INTEGER + 2, 1)).toThrow(TimeError);
    expect(() => rational(Number.NaN, 1)).toThrow(TimeError);
  });
});

describe("mediaTime", () => {
  it("stores integer ticks with an explicit timebase", () => {
    const t = mediaTime(1001, FPS_23_976);
    expect(t).toEqual({ ticks: 1001, timebase: { numerator: 24000, denominator: 1001 } });
  });

  it("rejects fractional, unsafe or non-finite ticks", () => {
    expect(() => mediaTime(1.5, FPS_24)).toThrow(TimeError);
    expect(() => mediaTime(MAX_SAFE_TICKS + 1, FPS_24)).toThrow(TimeError);
    expect(() => mediaTime(Number.POSITIVE_INFINITY, FPS_24)).toThrow(TimeError);
  });

  it("allows negative ticks (offsets)", () => {
    expect(mediaTime(-10, FPS_24).ticks).toBe(-10);
  });
});

describe("compareMediaTime", () => {
  it("compares exactly within one timebase", () => {
    expect(compareMediaTime(mediaTime(10, FPS_24), mediaTime(11, FPS_24))).toBe(-1);
    expect(compareMediaTime(mediaTime(11, FPS_24), mediaTime(11, FPS_24))).toBe(0);
    expect(compareMediaTime(mediaTime(12, FPS_24), mediaTime(11, FPS_24))).toBe(1);
  });

  it("compares exactly across timebases without floating point", () => {
    // 1 second at 23.976 fps = 24000/1001 frames; expressed in 1001-tick units: 24000 ticks @ 24000/1001 == 48048 ticks @ 48000/1 ... use an exact pair
    // 1001 frames @ 24000/1001 fps == 1001 * 1001 / 24000 s; at 48000 Hz that is 1001*1001*2 = 2004002 samples
    const a = mediaTime(1001, FPS_23_976);
    const b = mediaTime(2004002, rational(48000, 1));
    expect(compareMediaTime(a, b)).toBe(0);
    expect(compareMediaTime(a, mediaTime(2004003, rational(48000, 1)))).toBe(-1);
    expect(compareMediaTime(a, mediaTime(2004001, rational(48000, 1)))).toBe(1);
  });

  it("stays exact near the safe-integer limit (no 2^53 overflow in intermediates)", () => {
    const big = MAX_SAFE_TICKS; // 2^53 - 1
    const a = mediaTime(big, FPS_23_976);
    const b = mediaTime(big, FPS_29_97);
    // same tick count, but 29.97 ticks are shorter than 23.976 ticks, so a > b
    expect(compareMediaTime(a, b)).toBe(1);
    expect(compareMediaTime(b, a)).toBe(-1);
    // a float cross-multiply would lose the final digit here
    const c = mediaTime(big - 1, FPS_23_976);
    expect(compareMediaTime(a, c)).toBe(1);
    expect(compareMediaTime(c, a)).toBe(-1);
  });
});

describe("convertMediaTime", () => {
  it("converts exactly when the target timebase represents the value", () => {
    const t = mediaTime(24, FPS_24); // 1 second
    expect(convertMediaTime(t, rational(48000, 1))).toEqual(mediaTime(48000, rational(48000, 1)));
    expect(convertMediaTime(mediaTime(1001, FPS_23_976), rational(48000, 1)).ticks).toBe(2004002);
  });

  it("refuses inexact conversion unless rounding is explicit", () => {
    const t = mediaTime(1, FPS_23_976); // 1001/24000 s, not representable at 24/1
    expect(() => convertMediaTime(t, FPS_24)).toThrow(TimeError);
    expect(convertMediaTime(t, FPS_24, { rounding: "floor" }).ticks).toBe(1);
    expect(convertMediaTime(t, FPS_24, { rounding: "ceil" }).ticks).toBe(2);
    expect(convertMediaTime(t, FPS_24, { rounding: "nearest" }).ticks).toBe(1);
    expect(convertMediaTime(mediaTime(-1, FPS_23_976), FPS_24, { rounding: "floor" }).ticks).toBe(-2);
  });

  it("rejects results outside the safe-integer range", () => {
    const t = mediaTime(MAX_SAFE_TICKS, FPS_24);
    expect(() => convertMediaTime(t, rational(48000, 1))).toThrow(TimeError);
  });

  it("is the identity for the same timebase", () => {
    const t = mediaTime(7, FPS_29_97);
    expect(convertMediaTime(t, rational(60000, 2002))).toEqual(t);
  });
});

describe("timeRange", () => {
  it("requires start and end in the same timebase and end >= start", () => {
    const r = timeRange(mediaTime(0, FPS_24), mediaTime(48, FPS_24));
    expect(durationTicks(r)).toBe(48);
    expect(isSameTimebase(r.start, r.end)).toBe(true);
    expect(() => validateTimeRange({ start: mediaTime(10, FPS_24), end: mediaTime(9, FPS_24) })).toThrow(TimeError);
    expect(() => validateTimeRange({ start: mediaTime(0, FPS_24), end: mediaTime(9, FPS_23_976) })).toThrow(TimeError);
  });

  it("allows an empty range and reports it", () => {
    const r = timeRange(mediaTime(5, FPS_24), mediaTime(5, FPS_24));
    expect(durationTicks(r)).toBe(0);
  });
});
