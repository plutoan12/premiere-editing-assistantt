import { describe, expect, it } from "vitest";
import { newEntityId } from "./ids.js";
import { FPS_23_976, mediaTime, rational } from "./time.js";
import { SyncGroupSchema, validateSyncGroup, type SyncGroup } from "./sync.js";
import type { MediaAsset } from "./media.js";
import { CORE_SCHEMA_VERSION } from "./version.js";

const projectId = newEntityId();
const fingerprint = { algorithm: "sha256", value: "b".repeat(64), sizeBytes: 10, strategy: "full" } as const;

function asset(id = newEntityId(), project = projectId): MediaAsset {
  return {
    schemaVersion: CORE_SCHEMA_VERSION,
    id,
    projectId: project,
    sourcePath: `/media/${id}.wav`,
    source: { immutable: true, fingerprint },
    duration: mediaTime(480000, rational(48000, 1)),
    audio: { sampleRate: 48000, channels: 1 },
  };
}

function group(members: SyncGroup["members"], reference = members[0]!.mediaAssetId): SyncGroup {
  return { schemaVersion: CORE_SCHEMA_VERSION, id: newEntityId(), projectId, referenceMediaAssetId: reference, members };
}

describe("SyncGroup", () => {
  const cam = asset();
  const rec = asset();

  it("accepts two members with explicit offsets relative to a zero-offset reference", () => {
    const g = group([
      { mediaAssetId: cam.id, offset: mediaTime(0, FPS_23_976), method: "timecode" },
      { mediaAssetId: rec.id, offset: mediaTime(-2400, rational(48000, 1)), method: "waveform", confidence: 0.98 },
    ]);
    expect(SyncGroupSchema.parse(g)).toEqual(g);
    expect(validateSyncGroup(g, [cam, rec])).toEqual(g);
  });

  it("needs at least two members", () => {
    const g = group([{ mediaAssetId: cam.id, offset: mediaTime(0, FPS_23_976), method: "manual" }]);
    expect(SyncGroupSchema.safeParse(g).success).toBe(false);
  });

  it("requires the reference to be a member with offset zero and unique member assets", () => {
    const members: SyncGroup["members"] = [
      { mediaAssetId: cam.id, offset: mediaTime(0, FPS_23_976), method: "timecode" },
      { mediaAssetId: rec.id, offset: mediaTime(5, FPS_23_976), method: "timecode" },
    ];
    expect(SyncGroupSchema.safeParse(group(members, newEntityId())).success).toBe(false);
    expect(SyncGroupSchema.safeParse(group(members, rec.id)).success).toBe(false);
    expect(SyncGroupSchema.safeParse(group([members[0]!, members[0]!])).success).toBe(false);
  });

  it("bounds confidence to [0, 1]", () => {
    const g = group([
      { mediaAssetId: cam.id, offset: mediaTime(0, FPS_23_976), method: "timecode" },
      { mediaAssetId: rec.id, offset: mediaTime(5, FPS_23_976), method: "ai", confidence: 1.2 },
    ]);
    expect(SyncGroupSchema.safeParse(g).success).toBe(false);
  });

  it("rejects members whose assets are missing or belong to another project", () => {
    const g = group([
      { mediaAssetId: cam.id, offset: mediaTime(0, FPS_23_976), method: "timecode" },
      { mediaAssetId: rec.id, offset: mediaTime(5, FPS_23_976), method: "timecode" },
    ]);
    expect(() => validateSyncGroup(g, [cam])).toThrow(/missing/);
    expect(() => validateSyncGroup(g, [cam, asset(rec.id, newEntityId())])).toThrow(/project/);
  });
});
