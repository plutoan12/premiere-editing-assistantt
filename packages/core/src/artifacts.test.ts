import { describe, expect, it } from "vitest";
import { newEntityId } from "./ids.js";
import {
  ARTIFACT_STATUSES,
  ArtifactLifecycleError,
  ArtifactSchema,
  createCandidateArtifact,
  deriveCacheKey,
  promoteArtifact,
  validateArtifact,
  type Artifact,
  type ArtifactProvenance,
} from "./artifacts.js";

const projectId = newEntityId();
const provenance: ArtifactProvenance = {
  producer: { module: "@pea/subtitle", version: "0.1.0" },
  provider: { name: "stt-provider", model: "large-v3", version: "1.2.0" },
  prompt: { id: "transcript-cleanup", version: "4" },
  createdAt: "2026-10-27T00:00:00.000Z",
  inputFingerprints: ["a".repeat(64)],
  configHash: "b".repeat(64),
};

function candidate(overrides: Partial<ArtifactProvenance> = {}): Artifact {
  return createCandidateArtifact(
    { projectId, kind: "transcript", uri: "artifacts/transcript/1.json", provenance: { ...provenance, ...overrides }, jobId: newEntityId() },
    () => new Date("2026-10-27T01:00:00.000Z"),
  );
}

describe("deriveCacheKey", () => {
  it("is stable for equal provenance and independent of createdAt", () => {
    expect(deriveCacheKey(provenance)).toBe(deriveCacheKey({ ...provenance, createdAt: "2030-01-01T00:00:00.000Z" }));
    expect(deriveCacheKey(provenance)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when model, prompt, config or any input fingerprint changes", () => {
    const base = deriveCacheKey(provenance);
    expect(deriveCacheKey({ ...provenance, provider: { ...provenance.provider!, model: "large-v2" } })).not.toBe(base);
    expect(deriveCacheKey({ ...provenance, prompt: { id: "transcript-cleanup", version: "5" } })).not.toBe(base);
    expect(deriveCacheKey({ ...provenance, configHash: "c".repeat(64) })).not.toBe(base);
    expect(deriveCacheKey({ ...provenance, inputFingerprints: ["d".repeat(64)] })).not.toBe(base);
    expect(deriveCacheKey({ ...provenance, producer: { module: "@pea/subtitle", version: "0.2.0" } })).not.toBe(base);
  });
});

describe("Artifact", () => {
  it("has exactly the spec statuses", () => {
    expect([...ARTIFACT_STATUSES]).toEqual(["candidate", "validated", "current", "superseded", "rejected"]);
  });

  it("starts as a candidate whose cacheKey is derived from its provenance", () => {
    const c = candidate();
    expect(c.status).toBe("candidate");
    expect(c.cacheKey).toBe(deriveCacheKey(c.provenance));
    expect(ArtifactSchema.parse(c)).toEqual(c);
    expect(ArtifactSchema.safeParse({ ...c, cacheKey: "0".repeat(64) }).success).toBe(false);
  });

  it("requires input fingerprints and a config hash in artifact provenance", () => {
    const c = candidate();
    const { inputFingerprints: _f, ...noInputs } = c.provenance;
    expect(ArtifactSchema.safeParse({ ...c, provenance: noInputs }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...c, provenance: { ...c.provenance, inputFingerprints: [] } }).success).toBe(false);
  });
});

describe("validateArtifact", () => {
  it("moves a candidate to validated or rejected and nowhere else", () => {
    const c = candidate();
    expect(validateArtifact(c, { ok: true }).status).toBe("validated");
    const rejected = validateArtifact(c, { ok: false, reason: "schema mismatch" });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejection).toBe("schema mismatch");
    expect(() => validateArtifact(rejected, { ok: true })).toThrow(ArtifactLifecycleError);
    expect(c.status).toBe("candidate");
  });
});

describe("promoteArtifact", () => {
  it("promotes only a validated candidate", () => {
    const validated = validateArtifact(candidate(), { ok: true });
    const { current, superseded } = promoteArtifact(validated);
    expect(current.status).toBe("current");
    expect(current.id).toBe(validated.id);
    expect(superseded).toBeUndefined();
    expect(validated.status).toBe("validated");
  });

  it("refuses candidate and rejected inputs so a failed output never replaces current", () => {
    const current = promoteArtifact(validateArtifact(candidate(), { ok: true })).current;
    const failedOutput = candidate({ configHash: "e".repeat(64) });
    expect(() => promoteArtifact(failedOutput, current)).toThrow(ArtifactLifecycleError);
    const rejected = validateArtifact(failedOutput, { ok: false, reason: "job failed" });
    expect(() => promoteArtifact(rejected, current)).toThrow(ArtifactLifecycleError);
    expect(current.status).toBe("current");
  });

  it("atomically supersedes the previous current of the same project and kind", () => {
    const first = promoteArtifact(validateArtifact(candidate(), { ok: true })).current;
    const next = validateArtifact(candidate({ provider: { name: "stt-provider", model: "large-v4" } }), { ok: true });
    const { current, superseded } = promoteArtifact(next, first);
    expect(current.status).toBe("current");
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.supersededBy).toBe(current.id);
    expect(first.status).toBe("current"); // input untouched
    expect(ArtifactSchema.parse(superseded)).toEqual(superseded);
  });

  it("refuses to supersede something that is not current or belongs to another project/kind", () => {
    const next = validateArtifact(candidate(), { ok: true });
    const notCurrent = validateArtifact(candidate(), { ok: true });
    expect(() => promoteArtifact(next, notCurrent)).toThrow(ArtifactLifecycleError);
    const otherKind = { ...promoteArtifact(validateArtifact(candidate(), { ok: true })).current, kind: "sequence-plan" };
    expect(() => promoteArtifact(next, otherKind)).toThrow(ArtifactLifecycleError);
  });

  it("only allows supersededBy on superseded and rejection on rejected", () => {
    const c = candidate();
    expect(ArtifactSchema.safeParse({ ...c, supersededBy: newEntityId() }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...c, rejection: "x" }).success).toBe(false);
  });
});
