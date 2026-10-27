import { describe, expect, it } from "vitest";
import {
  ArtifactLifecycleError,
  ArtifactSchema,
  deriveCacheKey,
  promoteArtifact,
  rejectArtifact,
  resolveArtifactPromotion,
  validateArtifact,
  type Artifact,
  type ArtifactProvenance,
} from "./artifacts.js";

const provenance: ArtifactProvenance = {
  provider: "whisper-local",
  model: "large-v3",
  version: "1.2.0",
  promptVersion: "4",
  producerModule: "@pea/subtitle",
  producerVersion: "0.1.0",
  inputFingerprints: ["a".repeat(64)],
  configHash: "b".repeat(64),
};

describe("artifact promotion", () => {
  it("preserves current valid artifact when candidate failed", () => {
    const current = { id: "a", kind: "stt", version: 1, status: "valid" as const };
    const failed = { id: "b", kind: "stt", version: 2, status: "failed" as const };
    expect(promoteArtifact(failed, current)).toEqual(current);
    expect(resolveArtifactPromotion(failed, current)).toEqual({ current });
  });

  it("promotes valid candidate", () => {
    const candidate = { id: "b", kind: "stt", version: 2, status: "valid" as const };
    expect(promoteArtifact(candidate)).toEqual(candidate);
    expect(resolveArtifactPromotion(candidate)).toEqual({ current: candidate });
  });

  it("never lets an unvalidated candidate replace current", () => {
    const current: Artifact = { id: "a", kind: "stt", version: 1, status: "valid" };
    const candidate: Artifact = { id: "b", kind: "stt", version: 2, status: "candidate" };
    expect(promoteArtifact(candidate, current)).toEqual(current);
    expect(resolveArtifactPromotion(candidate, current)).toEqual({ current });
  });

  it("supersedes the previous current atomically without mutating inputs", () => {
    const current: Artifact = { id: "a", kind: "stt", version: 1, status: "valid" };
    const next: Artifact = { id: "b", kind: "stt", version: 2, status: "valid" };
    const result = resolveArtifactPromotion(next, current);
    expect(result.current).toEqual(next);
    expect(result.superseded).toEqual({ ...current, status: "superseded", supersededBy: "b" });
    expect(current.status).toBe("valid");
  });

  it("refuses to replace an artifact of another kind or one that is not current", () => {
    const next: Artifact = { id: "b", kind: "stt", version: 2, status: "valid" };
    expect(() => promoteArtifact(next, { id: "a", kind: "media-probe", version: 1, status: "valid" })).toThrow(ArtifactLifecycleError);
    expect(() => promoteArtifact(next, { id: "a", kind: "stt", version: 1, status: "superseded", supersededBy: "z" })).toThrow(ArtifactLifecycleError);
  });

  it("validates or rejects a candidate and nothing else", () => {
    const candidate: Artifact = { id: "c", kind: "stt", version: 1, status: "candidate" };
    expect(validateArtifact(candidate).status).toBe("valid");
    const rejected = rejectArtifact(candidate, "schema mismatch");
    expect(rejected).toEqual({ ...candidate, status: "failed", rejection: "schema mismatch" });
    expect(() => validateArtifact(rejected)).toThrow(ArtifactLifecycleError);
    expect(() => rejectArtifact(validateArtifact(candidate), "x")).toThrow(ArtifactLifecycleError);
  });
});

describe("artifact provenance and cache key", () => {
  it("derives a stable cache key from the provenance inputs", () => {
    expect(deriveCacheKey(provenance)).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveCacheKey({ ...provenance })).toBe(deriveCacheKey(provenance));
  });

  it("changes the key when model, prompt, config or input fingerprints change", () => {
    const base = deriveCacheKey(provenance);
    expect(deriveCacheKey({ ...provenance, model: "large-v2" })).not.toBe(base);
    expect(deriveCacheKey({ ...provenance, promptVersion: "5" })).not.toBe(base);
    expect(deriveCacheKey({ ...provenance, configHash: "c".repeat(64) })).not.toBe(base);
    expect(deriveCacheKey({ ...provenance, inputFingerprints: ["d".repeat(64)] })).not.toBe(base);
  });

  it("requires cacheKey to match provenance and keeps lifecycle fields consistent", () => {
    const a: Artifact = { id: "a", kind: "stt", version: 1, status: "valid", provenance, cacheKey: deriveCacheKey(provenance) };
    expect(ArtifactSchema.parse(a)).toEqual(a);
    expect(ArtifactSchema.safeParse({ ...a, cacheKey: "0".repeat(64) }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...a, provenance: { ...provenance, inputFingerprints: [] } }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...a, supersededBy: "b" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...a, status: "superseded" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...a, rejection: "x" }).success).toBe(false);
    // legacy catalog artifacts without provenance still parse
    expect(ArtifactSchema.parse({ id: "a", kind: "media-probe", version: 3, status: "valid" }).status).toBe("valid");
  });
});
