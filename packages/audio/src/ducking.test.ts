import { describe, expect, it } from "vitest";
import { buildDuckingEnvelope } from "./ducking.js";
import { parseAudioDecision, serializeAudioDecision } from "./decisions.js";

const request = { id: "d", clipId: "bgm-clip", mediaAssetId: "music", sampleRate: 1000, range: { start: 0n, end: 1000n }, dialogue: [{ start: 400n, end: 600n }], amountDb: -12, attackSamples: 100n, holdSamples: 50n, releaseSamples: 100n };
const points = (value: ReturnType<typeof buildDuckingEnvelope>) => value.points.map(p => [p.time.ticks, p.gainDb]);

describe("ducking envelopes", () => {
  it("places attack, hold and release around dialogue", () => {
    expect(points(buildDuckingEnvelope(request))).toEqual([[0n, 0], [300n, 0], [400n, -12], [650n, -12], [750n, 0], [1000n, 0]]);
  });
  it("merges overlapping speech supports to avoid pumping", () => {
    expect(points(buildDuckingEnvelope({ ...request, dialogue: [{ start: 700n, end: 800n }, { start: 400n, end: 600n }] }))).toEqual([[0n, 0], [300n, 0], [400n, -12], [850n, -12], [950n, 0], [1000n, 0]]);
  });
  it("clips ramps at the BGM boundary without resetting their gain", () => {
    expect(points(buildDuckingEnvelope({ ...request, range: { start: 350n, end: 700n } }))).toEqual([[350n, -6], [400n, -12], [650n, -12], [700n, -6]]);
  });
  it("keeps BGM unchanged for empty dialogue and preserves the input", () => {
    expect(points(buildDuckingEnvelope({ ...request, dialogue: [] }))).toEqual([[0n, 0], [1000n, 0]]);
    expect(request.dialogue).toEqual([{ start: 400n, end: 600n }]);
  });
  it("rejects invalid attenuation, sample intervals and ramps", () => {
    for (const patch of [{ amountDb: 1 }, { attackSamples: 0n }, { releaseSamples: -1n }, { range: { start: 2n, end: 1n } }, { dialogue: [{ start: -1n, end: 1n }] }]) {
      expect(() => buildDuckingEnvelope({ ...request, ...patch })).toThrow();
    }
  });
  it("keeps a finite attenuation finite while interpolating a clipped ramp", () => {
    const result = buildDuckingEnvelope({ ...request, amountDb: -1e308, range: { start: 350n, end: 700n } });
    expect(result.points[0].gainDb).toBe(-5e307);
    expect(result.points[result.points.length - 1].gainDb).toBe(-5e307);
  });
});

describe("versioned audio decisions", () => {
  it("round-trips exact bigints and retains the Core decision contract", () => {
    const start = 9007199254740993n;
    const result = buildDuckingEnvelope({ ...request, range: { start, end: start + 1000n }, dialogue: [] });
    const json = serializeAudioDecision(result);
    expect(json).toContain('"9007199254740993"');
    expect(parseAudioDecision(json)).toEqual(result);
    expect(result.decision.kind).toBe("duck");
  });
  it("rejects future versions, unordered points and out-of-range points", () => {
    const data = JSON.parse(serializeAudioDecision(buildDuckingEnvelope(request)));
    expect(() => parseAudioDecision(JSON.stringify({ ...data, schemaVersion: "2.0.0" }))).toThrow();
    expect(() => parseAudioDecision(JSON.stringify({ ...data, points: [...data.points].reverse() }))).toThrow();
    data.points[0].time.ticks = "-1";
    expect(() => parseAudioDecision(JSON.stringify(data))).toThrow();
  });
});
