import { describe, expect, it } from "vitest";
import { newEntityId } from "./ids.js";
import { FPS_23_976, mediaTime, rational } from "./time.js";
import {
  AudioDecisionSchema,
  DeliveryVariantSchema,
  EditDecisionSchema,
  GraphicDecisionSchema,
  SequencePlanSchema,
  validateSequencePlan,
  type EditDecision,
  type SequencePlan,
} from "./edit.js";
import type { MediaAsset } from "./media.js";
import { CORE_SCHEMA_VERSION } from "./version.js";
import { sampleProvenance } from "./testing/fixtures.js";

const projectId = newEntityId();
const asset: MediaAsset = {
  schemaVersion: CORE_SCHEMA_VERSION,
  id: newEntityId(),
  projectId,
  sourcePath: "/media/a.mov",
  source: { immutable: true, fingerprint: { algorithm: "sha256", value: "e".repeat(64), sizeBytes: 1, strategy: "full" } },
  duration: mediaTime(2400, FPS_23_976),
  video: { frameRate: FPS_23_976, width: 1920, height: 1080 },
  audio: { sampleRate: 48000, channels: 2 },
};

function decision(overrides: Partial<EditDecision> = {}): EditDecision {
  return {
    id: newEntityId(),
    kind: "insert",
    clip: { id: newEntityId(), mediaAssetId: asset.id, sourceRange: { start: mediaTime(100, FPS_23_976), end: mediaTime(200, FPS_23_976) } },
    destination: { trackKind: "video", trackIndex: 0, position: mediaTime(0, FPS_23_976) },
    enabled: true,
    ...overrides,
  };
}

function plan(decisions: EditDecision[]): SequencePlan {
  return {
    schemaVersion: CORE_SCHEMA_VERSION,
    id: newEntityId(),
    projectId,
    name: "Rough cut v1",
    frameRate: FPS_23_976,
    timebase: FPS_23_976,
    sourcePolicy: "reference-only",
    decisions,
    provenance: sampleProvenance,
  };
}

describe("EditDecision", () => {
  it("references source media by clip and places it on a destination track", () => {
    const d = decision();
    expect(EditDecisionSchema.parse(d)).toEqual(d);
  });

  it("rejects invalid source ranges and negative destination placement", () => {
    const d = decision();
    expect(EditDecisionSchema.safeParse(decision({ clip: { ...d.clip, sourceRange: { start: mediaTime(5, FPS_23_976), end: mediaTime(4, FPS_23_976) } } })).success).toBe(false);
    expect(EditDecisionSchema.safeParse(decision({ destination: { ...d.destination, position: mediaTime(-1, FPS_23_976) } })).success).toBe(false);
    expect(EditDecisionSchema.safeParse(decision({ destination: { ...d.destination, trackIndex: -1 } })).success).toBe(false);
  });

  it("is non-destructive: only insert/overwrite exist and source mutation keys are rejected", () => {
    expect(EditDecisionSchema.safeParse(decision({ kind: "deleteSource" as never })).success).toBe(false);
    expect(EditDecisionSchema.safeParse({ ...decision(), trimSourceFile: true }).success).toBe(false);
  });
});

describe("SequencePlan", () => {
  it("validates a plan whose clips fit their assets", () => {
    const p = plan([decision(), decision({ destination: { trackKind: "audio", trackIndex: 1, position: mediaTime(0, rational(48000, 1)) } })]);
    expect(SequencePlanSchema.parse(p)).toEqual(p);
    expect(validateSequencePlan(p, [asset])).toEqual(p);
  });

  it("requires the reference-only source policy and unique decision ids", () => {
    const p = plan([decision()]);
    expect(SequencePlanSchema.safeParse({ ...p, sourcePolicy: "copy-and-trim" }).success).toBe(false);
    const d = decision();
    expect(SequencePlanSchema.safeParse(plan([d, d])).success).toBe(false);
  });

  it("rejects clips that exceed their asset or reference unknown assets", () => {
    const beyond = decision({ clip: { id: newEntityId(), mediaAssetId: asset.id, sourceRange: { start: mediaTime(0, FPS_23_976), end: mediaTime(2401, FPS_23_976) } } });
    expect(() => validateSequencePlan(plan([beyond]), [asset])).toThrow(/duration/);
    const unknown = decision({ clip: { id: newEntityId(), mediaAssetId: newEntityId(), sourceRange: { start: mediaTime(0, FPS_23_976), end: mediaTime(1, FPS_23_976) } } });
    expect(() => validateSequencePlan(plan([unknown]), [asset])).toThrow(/missing/);
  });
});

describe("GraphicDecision", () => {
  it("binds a template reference to a range, track and parameters", () => {
    const g = {
      id: newEntityId(),
      template: { kind: "mogrt", ref: "LowerThird_Clean", version: "2" },
      range: { start: mediaTime(0, FPS_23_976), end: mediaTime(120, FPS_23_976) },
      trackIndex: 3,
      parameters: { name: "Host", title: "Editor", accent: "#ff6600", visible: true, size: 42 },
      provenance: sampleProvenance,
    };
    expect(GraphicDecisionSchema.parse(g)).toEqual(g);
    expect(GraphicDecisionSchema.safeParse({ ...g, parameters: { nested: { a: 1 } } }).success).toBe(false);
    expect(GraphicDecisionSchema.safeParse({ ...g, template: { kind: "after-effects-comp", ref: "x" } }).success).toBe(false);
  });
});

describe("AudioDecision", () => {
  it("targets a track or a clip and carries numeric parameters", () => {
    const a = { id: newEntityId(), kind: "duck", target: { trackKind: "audio", trackIndex: 2 }, range: { start: mediaTime(0, FPS_23_976), end: mediaTime(48, FPS_23_976) }, parameters: { gainDb: -12, attackMs: 80 } };
    expect(AudioDecisionSchema.parse(a)).toEqual(a);
    const byClip = { ...a, target: { clipId: newEntityId() } };
    expect(AudioDecisionSchema.parse(byClip)).toEqual(byClip);
    expect(AudioDecisionSchema.safeParse({ ...a, target: { trackKind: "video", trackIndex: 0 } }).success).toBe(false);
    expect(AudioDecisionSchema.safeParse({ ...a, parameters: { gainDb: "loud" } }).success).toBe(false);
  });
});

describe("DeliveryVariant", () => {
  it("describes frame size, reframe policy, locale and export preset", () => {
    const v = { id: newEntityId(), name: "Vertical KR", frame: { width: 1080, height: 1920 }, reframe: "auto-subject", locale: "ko-KR", exportPreset: "H.264 Social" };
    expect(DeliveryVariantSchema.parse(v)).toEqual(v);
    expect(DeliveryVariantSchema.safeParse({ ...v, frame: { width: 0, height: 1920 } }).success).toBe(false);
    expect(DeliveryVariantSchema.safeParse({ ...v, reframe: "crop-whatever" }).success).toBe(false);
  });
});
