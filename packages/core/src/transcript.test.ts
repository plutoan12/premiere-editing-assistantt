import { describe, expect, it } from "vitest";
import { newEntityId } from "./ids.js";
import { FPS_23_976, mediaTime, rational } from "./time.js";
import { SpeakerSchema, TranscriptSchema, TranscriptSegmentSchema, validateTranscript, type Transcript } from "./transcript.js";
import type { MediaAsset } from "./media.js";
import { CORE_SCHEMA_VERSION } from "./version.js";
import { sampleProvenance as provenance } from "./testing/fixtures.js";

const ms = rational(1000, 1);
const seg = (start: number, end: number, text: string, speakerId?: string) => ({
  id: newEntityId(),
  range: { start: mediaTime(start, ms), end: mediaTime(end, ms) },
  text,
  ...(speakerId === undefined ? {} : { speakerId }),
});

function transcript(overrides: Partial<Transcript> = {}): Transcript {
  const speaker = { id: newEntityId(), label: "Host" };
  return TranscriptSchema.parse({
    schemaVersion: CORE_SCHEMA_VERSION,
    id: newEntityId(),
    mediaAssetId: newEntityId(),
    language: "ko-KR",
    speakers: [speaker],
    segments: [seg(0, 1200, "안녕하세요", speaker.id), seg(1200, 2500, "반갑습니다", speaker.id), seg(3000, 3100, "")],
    provenance,
    ...overrides,
  });
}

describe("Speaker", () => {
  it("has an id and a label", () => {
    const s = { id: newEntityId(), label: "Guest", confidence: 0.7 };
    expect(SpeakerSchema.parse(s)).toEqual(s);
    expect(SpeakerSchema.safeParse({ id: newEntityId(), label: "" }).success).toBe(false);
  });
});

describe("TranscriptSegment", () => {
  it("binds text to a time range and optional speaker", () => {
    const s = seg(0, 10, "hi");
    expect(TranscriptSegmentSchema.parse(s)).toEqual(s);
  });

  it("supports word timings inside the segment", () => {
    const s = { ...seg(0, 1000, "hi there"), words: [{ text: "hi", range: { start: mediaTime(0, ms), end: mediaTime(400, ms) } }, { text: "there", range: { start: mediaTime(400, ms), end: mediaTime(1000, ms) } }] };
    expect(TranscriptSegmentSchema.parse(s)).toEqual(s);
    const outside = { ...s, words: [{ text: "hi", range: { start: mediaTime(0, ms), end: mediaTime(1001, ms) } }] };
    expect(TranscriptSegmentSchema.safeParse(outside).success).toBe(false);
  });
});

describe("Transcript", () => {
  it("validates ordered, non-overlapping segments with known speakers", () => {
    const t = transcript();
    expect(t.segments).toHaveLength(3);
    expect(t.language).toBe("ko-KR");
  });

  it("rejects out-of-order and overlapping segments", () => {
    const base = transcript();
    const [a, b] = base.segments as [Transcript["segments"][number], Transcript["segments"][number], ...unknown[]];
    expect(TranscriptSchema.safeParse({ ...base, segments: [b, a] }).success).toBe(false);
    const overlapping = { ...b, range: { start: mediaTime(1100, ms), end: b.range.end } };
    expect(TranscriptSchema.safeParse({ ...base, segments: [a, overlapping] }).success).toBe(false);
  });

  it("rejects segments that reference unknown speakers", () => {
    const base = transcript();
    expect(TranscriptSchema.safeParse({ ...base, segments: [seg(0, 1, "x", newEntityId())] }).success).toBe(false);
  });

  it("rejects an invalid language tag and missing provenance", () => {
    const base = transcript();
    expect(TranscriptSchema.safeParse({ ...base, language: "korean language" }).success).toBe(false);
    const { provenance: _p, ...noProvenance } = base;
    expect(TranscriptSchema.safeParse(noProvenance).success).toBe(false);
  });

  it("is media-bound: segments must fit inside the asset duration", () => {
    const t = transcript();
    const asset: MediaAsset = {
      schemaVersion: CORE_SCHEMA_VERSION,
      id: t.mediaAssetId,
      projectId: newEntityId(),
      sourcePath: "/media/a.wav",
      source: { immutable: true, fingerprint: { algorithm: "sha256", value: "d".repeat(64), sizeBytes: 1, strategy: "full" } },
      duration: mediaTime(3100, ms),
      audio: { sampleRate: 48000, channels: 1 },
    };
    expect(validateTranscript(t, asset)).toEqual(t);
    expect(() => validateTranscript(t, { ...asset, duration: mediaTime(74, FPS_23_976) })).toThrow(/duration/); // 74 frames ≈ 3.087 s < 3.1 s
    expect(() => validateTranscript(t, { ...asset, id: newEntityId() })).toThrow(/asset/);
  });
});
