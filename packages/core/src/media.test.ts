import { describe, expect, it } from "vitest";
import { newEntityId } from "./ids.js";
import { FPS_23_976, mediaTime, rational } from "./time.js";
import { ClipReferenceSchema, MediaAssetSchema, MediaFingerprintSchema, validateClipReference, type MediaAsset } from "./media.js";
import { CORE_SCHEMA_VERSION } from "./version.js";

const fingerprint = { algorithm: "sha256", value: "a".repeat(64), sizeBytes: 1024, strategy: "full" } as const;

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    schemaVersion: CORE_SCHEMA_VERSION,
    id: newEntityId(),
    projectId: newEntityId(),
    sourcePath: "/Volumes/Media/A001_C001.mov",
    source: { immutable: true, fingerprint },
    duration: mediaTime(2400, FPS_23_976),
    video: { frameRate: FPS_23_976, width: 3840, height: 2160 },
    audio: { sampleRate: 48000, channels: 2 },
    ...overrides,
  };
}

describe("MediaFingerprint", () => {
  it("accepts a hex digest with size and strategy", () => {
    expect(MediaFingerprintSchema.parse(fingerprint)).toEqual(fingerprint);
  });
  it("rejects non-hex or wrong-length digests", () => {
    expect(MediaFingerprintSchema.safeParse({ ...fingerprint, value: "zz" }).success).toBe(false);
    expect(MediaFingerprintSchema.safeParse({ ...fingerprint, value: "ab" }).success).toBe(false);
  });
});

describe("MediaAsset", () => {
  it("validates a complete asset", () => {
    const a = asset();
    expect(MediaAssetSchema.parse(a)).toEqual(a);
  });

  it("requires source immutability metadata to be literally true", () => {
    expect(MediaAssetSchema.safeParse(asset({ source: { immutable: false as unknown as true, fingerprint } })).success).toBe(false);
  });

  it("requires an explicit frame rate on video streams", () => {
    const a = asset();
    const { frameRate: _omit, ...video } = a.video!;
    expect(MediaAssetSchema.safeParse({ ...a, video }).success).toBe(false);
    expect(MediaAssetSchema.safeParse({ ...a, video: { ...a.video!, frameRate: 23.976 } }).success).toBe(false);
  });

  it("requires at least one stream and a non-negative duration", () => {
    const a = asset();
    const { video: _v, audio: _a, ...none } = a;
    expect(MediaAssetSchema.safeParse(none).success).toBe(false);
    expect(MediaAssetSchema.safeParse(asset({ duration: mediaTime(-1, FPS_23_976) })).success).toBe(false);
  });

  it("accepts audio-only assets", () => {
    const a = asset();
    const { video: _v, ...audioOnly } = a;
    expect(MediaAssetSchema.parse({ ...audioOnly, duration: mediaTime(96000, rational(48000, 1)) }).audio).toEqual(a.audio);
  });
});

describe("ClipReference", () => {
  it("accepts a range inside the asset", () => {
    const a = asset();
    const clip = { id: newEntityId(), mediaAssetId: a.id, sourceRange: { start: mediaTime(0, FPS_23_976), end: mediaTime(100, FPS_23_976) } };
    expect(ClipReferenceSchema.parse(clip)).toEqual(clip);
    expect(validateClipReference(clip, a)).toEqual(clip);
  });

  it("rejects negative-duration and out-of-asset ranges", () => {
    const a = asset();
    const bad = { id: newEntityId(), mediaAssetId: a.id, sourceRange: { start: mediaTime(10, FPS_23_976), end: mediaTime(9, FPS_23_976) } };
    expect(ClipReferenceSchema.safeParse(bad).success).toBe(false);
    const beyond = { ...bad, sourceRange: { start: mediaTime(0, FPS_23_976), end: mediaTime(2401, FPS_23_976) } };
    expect(() => validateClipReference(beyond, a)).toThrow(/duration/);
    const negativeStart = { ...bad, sourceRange: { start: mediaTime(-1, FPS_23_976), end: mediaTime(5, FPS_23_976) } };
    expect(() => validateClipReference(negativeStart, a)).toThrow(/negative/);
  });

  it("rejects a clip that points at a different asset", () => {
    const a = asset();
    const clip = { id: newEntityId(), mediaAssetId: newEntityId(), sourceRange: { start: mediaTime(0, FPS_23_976), end: mediaTime(1, FPS_23_976) } };
    expect(() => validateClipReference(clip, a)).toThrow(/asset/);
  });

  it("compares the range against the asset duration across timebases", () => {
    const a = asset(); // 2400 frames @ 23.976 = 100.1 s
    const clip = { id: newEntityId(), mediaAssetId: a.id, sourceRange: { start: mediaTime(0, rational(48000, 1)), end: mediaTime(4_804_800, rational(48000, 1)) } };
    expect(validateClipReference(clip, a)).toEqual(clip); // exactly 100.1 s
    expect(() => validateClipReference({ ...clip, sourceRange: { ...clip.sourceRange, end: mediaTime(4_804_801, rational(48000, 1)) } }, a)).toThrow(/duration/);
  });
});
