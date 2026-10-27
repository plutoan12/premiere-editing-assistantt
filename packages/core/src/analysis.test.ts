import { describe, expect, it } from "vitest";
import { newEntityId } from "./ids.js";
import { FPS_23_976, mediaTime } from "./time.js";
import { AnalysisTagSchema, ConfidenceSchema, ProvenanceSchema } from "./analysis.js";
import { sampleProvenance as provenance } from "./testing/fixtures.js";

describe("Confidence", () => {
  it("is bounded to [0, 1]", () => {
    expect(ConfidenceSchema.safeParse(0).success).toBe(true);
    expect(ConfidenceSchema.safeParse(1).success).toBe(true);
    expect(ConfidenceSchema.safeParse(1.0001).success).toBe(false);
    expect(ConfidenceSchema.safeParse(-0.1).success).toBe(false);
  });
});

describe("Provenance", () => {
  it("records producer, provider, prompt and input versions", () => {
    expect(ProvenanceSchema.parse(provenance)).toEqual(provenance);
  });

  it("works for deterministic producers without provider or prompt", () => {
    const { provider: _p, prompt: _q, ...deterministic } = provenance;
    expect(ProvenanceSchema.parse(deterministic)).toEqual(deterministic);
  });

  it("rejects provider-specific fields; vendor payloads never enter Core", () => {
    expect(ProvenanceSchema.safeParse({ ...provenance, provider: { ...provenance.provider, requestId: "req_1" } }).success).toBe(false);
    expect(ProvenanceSchema.safeParse({ ...provenance, rawResponse: {} }).success).toBe(false);
  });
});

describe("AnalysisTag", () => {
  const tag = {
    id: newEntityId(),
    mediaAssetId: newEntityId(),
    kind: "scene",
    value: "interview",
    range: { start: mediaTime(0, FPS_23_976), end: mediaTime(240, FPS_23_976) },
    confidence: 0.91,
    provenance,
  };

  it("validates a ranged tag", () => {
    expect(AnalysisTagSchema.parse(tag)).toEqual(tag);
  });

  it("allows asset-wide tags without a range", () => {
    const { range: _r, ...wide } = tag;
    expect(AnalysisTagSchema.parse(wide)).toEqual(wide);
  });

  it("requires confidence and provenance", () => {
    const { confidence: _c, ...noConfidence } = tag;
    const { provenance: _p, ...noProvenance } = tag;
    expect(AnalysisTagSchema.safeParse(noConfidence).success).toBe(false);
    expect(AnalysisTagSchema.safeParse(noProvenance).success).toBe(false);
    expect(AnalysisTagSchema.safeParse({ ...tag, confidence: 2 }).success).toBe(false);
  });

  it("rejects reversed ranges", () => {
    expect(AnalysisTagSchema.safeParse({ ...tag, range: { start: mediaTime(5, FPS_23_976), end: mediaTime(4, FPS_23_976) } }).success).toBe(false);
  });
});
