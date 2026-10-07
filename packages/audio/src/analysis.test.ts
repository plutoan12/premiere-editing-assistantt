import { describe, expect, it } from "vitest";
import { analyzeDialogue, measureSampleLevels, type DialogueGainOptions } from "./dialogue.js";
import { detectBeats } from "./beats.js";

const pcm = (channels: number[][], startSample = 0n) => ({ mediaAssetId: "m", fingerprint: { algorithm: "sha256" as const, value: "abc" }, sampleRate: 1000, startSample, channels: channels.map(x => new Float32Array(x)) });
const time = (ticks: bigint) => ({ ticks, timebase: { numerator: 1, denominator: 1000 } });

describe("dialogue levels", () => {
  it("measures anti-phase stereo without cancellation", () => {
    const result = measureSampleLevels(pcm([[0.5, -0.5], [-0.5, 0.5]]));
    expect(result.rmsDbfs).toBeCloseTo(-6.020599913, 7);
    expect(result.samplePeakDbfs).toBeCloseTo(-6.020599913, 7);
    expect(result.channelCount).toBe(2);
  });
  it("represents empty or silent signals without Infinity or made-up levels", () => {
    expect(measureSampleLevels(pcm([[]])).rmsDbfs).toBeNull();
    expect(measureSampleLevels(pcm([[0, 0]])).samplePeakDbfs).toBeNull();
  });
  it("clips transcript intervals to the decoded source window and limits gain", () => {
    const input = pcm([[0.5, 0.5, 0.5, 0.5]], 100n);
    const transcript = { id: "t", segments: [
      { id: "s", mediaAssetId: "m", text: "hello", range: { start: time(99n), duration: time(4n) } },
      { id: "other", mediaAssetId: "other", text: "skip", range: { start: time(100n), duration: time(1n) } },
    ] };
    const result = analyzeDialogue(input, transcript, { targetRmsDbfs: -2, maxGainDb: 12, maxSamplePeakDbfs: -3 });
    expect(result.status).toBe("ok");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].range).toEqual({ start: time(100n), duration: time(3n) });
    expect(result.segments[0].gainDb).toBeCloseTo(3.020599913, 7);
    expect([...input.channels[0]]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it("does not infer dialogue from loud non-speech PCM", () => {
    expect(analyzeDialogue(pcm([[1, 1]]), { id: "t", segments: [] }).status).toBe("no-dialogue");
  });
  it("rejects negative transcript durations and nonfinite gain settings", () => {
    expect(() => analyzeDialogue(pcm([[1]]), { id: "t", segments: [{ id: "s", mediaAssetId: "m", text: "x", range: { start: time(0n), duration: time(-1n) } }] })).toThrow();
    expect(() => analyzeDialogue(pcm([[1]]), { id: "t", segments: [] }, { targetRmsDbfs: NaN, maxGainDb: 1, maxSamplePeakDbfs: -1 })).toThrow();
  });
  it("rejects incomplete gain settings from an untyped caller rather than emitting NaN", () => {
    const transcript = { id: "t", segments: [{ id: "s", mediaAssetId: "m", text: "x", range: { start: time(0n), duration: time(1n) } }] };
    const incomplete = { targetRmsDbfs: -16, maxSamplePeakDbfs: -1 } as DialogueGainOptions;
    expect(() => analyzeDialogue(pcm([[0.5]]), transcript, incomplete)).toThrow(/configuration/i);
  });
});

describe("onsets and stable beat intervals", () => {
  const pulses = (positions: number[]) => { const samples = Array(2200).fill(0); for (const p of positions) samples[p] = 1; return samples; };
  it("finds 120 BPM in synthetic pulses with absolute source positions", () => {
    const result = detectBeats(pcm([pulses([0, 500, 1000, 1500, 2000])], 9007199254740993n), { hopSamples: 10 });
    expect(result.status).toBe("ok");
    expect(result.bpm).toBe(120);
    expect(result.onsets.map(x => x.ticks)).toEqual([9007199254740993n, 9007199254741493n, 9007199254741993n, 9007199254742493n, 9007199254742993n]);
  });
  it("keeps irregular onsets without inventing a BPM", () => {
    const result = detectBeats(pcm([pulses([0, 400, 1100, 1500, 2100])]));
    expect(result.status).toBe("irregular");
    expect(result.bpm).toBeNull();
    expect(result.onsets).toHaveLength(5);
  });
  it("distinguishes silence, short signals and sustained tone", () => {
    expect(detectBeats(pcm([[0, 0]])).status).toBe("silence");
    expect(detectBeats(pcm([[1]])).status).toBe("insufficient");
    expect(detectBeats(pcm([Array(2200).fill(0.5)])).bpm).toBeNull();
  });
  it("rejects invalid detector configuration", () => {
    expect(() => detectBeats(pcm([[1]]), { hopSamples: 0 })).toThrow();
    expect(() => detectBeats(pcm([[1]]), { minBpm: 200, maxBpm: 40 })).toThrow();
  });
});
