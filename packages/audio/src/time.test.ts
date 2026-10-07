import { describe, expect, it } from "vitest";
import { sampleTime, sourceToSequenceTime, timeToSamples } from "./time.js";
import { validatePcm } from "./pcm.js";

describe("exact audio time", () => {
  it("keeps NTSC frame time and very large sample positions exact", () => {
    expect(timeToSamples({ ticks: 5n, timebase: { numerator: 1001, denominator: 30000 } }, 48000)).toBe(8008n);
    const large = 9007199254740993n;
    expect(timeToSamples(sampleTime(large, 48000), 48000)).toBe(large);
  });
  it("requires explicit rounding for fractional samples, including negatives", () => {
    const half = { ticks: -1n, timebase: { numerator: 1, denominator: 96000 } };
    expect(() => timeToSamples(half, 48000)).toThrow(/fractional/i);
    expect(timeToSamples(half, 48000, "floor")).toBe(-1n);
    expect(timeToSamples(half, 48000, "ceil")).toBe(0n);
    expect(timeToSamples(half, 48000, "nearest")).toBe(-1n);
  });
  it("maps a trimmed source and rational speed without changing frames", () => {
    const clip = { id: "c", mediaAssetId: "m", sourceRange: { start: sampleTime(48000n, 48000), duration: sampleTime(96000n, 48000) } };
    const mapped = sourceToSequenceTime(sampleTime(72000n, 48000), clip, sampleTime(100n, 24), { numerator: 2, denominator: 1 });
    expect(mapped).toEqual({ ticks: 53n, timebase: { numerator: 1, denominator: 12 } });
    expect(() => sourceToSequenceTime(sampleTime(0n, 48000), clip, sampleTime(0n, 24))).toThrow(/outside/i);
    expect(() => sourceToSequenceTime(sampleTime(144000n, 48000), clip, sampleTime(0n, 24))).toThrow(/outside/i);
  });
  it("rejects unsafe or invalid timebases", () => {
    expect(() => sampleTime(1n, 0)).toThrow();
    expect(() => timeToSamples({ ticks: 1n, timebase: { numerator: Number.MAX_SAFE_INTEGER + 1, denominator: 1 } }, 48)).toThrow();
  });
});

describe("PCM validation", () => {
  const base = { mediaAssetId: "m", fingerprint: { algorithm: "sha256" as const, value: "abc" }, sampleRate: 48000, startSample: 0n };
  it("rejects malformed channels, rates and non-finite samples", () => {
    for (const channels of [[], [new Float32Array([NaN])], [new Float32Array(2), new Float32Array(1)]]) {
      expect(() => validatePcm({ ...base, channels })).toThrow();
    }
    expect(() => validatePcm({ ...base, sampleRate: 0, channels: [new Float32Array(0)] })).toThrow();
  });
  it("accepts empty PCM and above-full-scale samples without mutation", () => {
    expect(validatePcm({ ...base, channels: [new Float32Array(0)] })).toBe(0);
    const channel = new Float32Array([2, -2]);
    expect(validatePcm({ ...base, channels: [channel] })).toBe(2);
    expect([...channel]).toEqual([2, -2]);
  });
});
