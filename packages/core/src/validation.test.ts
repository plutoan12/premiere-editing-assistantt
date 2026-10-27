import { describe, expect, it } from "vitest";
import { createCandidateArtifact } from "./artifacts.js";
import { newEntityId } from "./ids.js";
import { createJob } from "./jobs.js";
import { createProject } from "./project.js";
import { FPS_23_976, mediaTime } from "./time.js";
import { CORE_DOCUMENT_TYPES, CoreValidationError, UnsupportedSchemaVersion, isSchemaVersionSupported, parseCoreDocument } from "./validation.js";
import { CORE_SCHEMA_VERSION } from "./version.js";
import { sampleProvenance } from "./testing/fixtures.js";

const project = createProject({ name: "Doc", frameRate: FPS_23_976 });
const asset = {
  schemaVersion: CORE_SCHEMA_VERSION,
  id: newEntityId(),
  projectId: project.id,
  sourcePath: "/media/a.mov",
  source: { immutable: true, fingerprint: { algorithm: "sha256", value: "a".repeat(64), sizeBytes: 1, strategy: "full" } },
  duration: mediaTime(2400, FPS_23_976),
  video: { frameRate: FPS_23_976, width: 1920, height: 1080 },
};

describe("isSchemaVersionSupported", () => {
  it("accepts the same major with a lower or equal minor and ignores patch", () => {
    expect(isSchemaVersionSupported("1.0.0", "1.0.0")).toBe(true);
    expect(isSchemaVersionSupported("1.0.7", "1.0.0")).toBe(true);
    expect(isSchemaVersionSupported("1.2.5", "1.3.0")).toBe(true);
    expect(isSchemaVersionSupported("1.3.9", "1.3.0")).toBe(true);
  });

  it("rejects a different major or a higher minor", () => {
    expect(isSchemaVersionSupported("1.1.0", "1.0.0")).toBe(false);
    expect(isSchemaVersionSupported("1.4.0", "1.3.0")).toBe(false);
    expect(isSchemaVersionSupported("2.0.0", "1.3.0")).toBe(false);
    expect(isSchemaVersionSupported("0.9.0", "1.0.0")).toBe(false);
  });

  it("rejects malformed versions", () => {
    expect(isSchemaVersionSupported("1.0", "1.0.0")).toBe(false);
    expect(isSchemaVersionSupported("v1.0.0", "1.0.0")).toBe(false);
  });
});

describe("parseCoreDocument", () => {
  it("parses valid v1 documents of every registered type", () => {
    expect(parseCoreDocument("project", project)).toEqual(project);
    expect(parseCoreDocument("mediaAsset", asset)).toEqual(asset);
    const job = createJob({ projectId: project.id, kind: "stt.transcribe" });
    expect(parseCoreDocument("job", job)).toEqual(job);
    const artifact = createCandidateArtifact({ projectId: project.id, kind: "transcript", uri: "a.json", provenance: { ...sampleProvenance, inputFingerprints: ["a".repeat(64)], configHash: "b".repeat(64) } });
    expect(parseCoreDocument("artifact", artifact)).toEqual(artifact);
    expect([...CORE_DOCUMENT_TYPES]).toEqual(["project", "mediaAsset", "syncGroup", "transcript", "sequencePlan", "job", "artifact"]);
  });

  it("reports malformed time values with a path", () => {
    const bad = { ...asset, duration: { ticks: 1.5, timebase: { numerator: 24000, denominator: 1001 } } };
    const error = catchError(() => parseCoreDocument("mediaAsset", bad));
    expect(error).toBeInstanceOf(CoreValidationError);
    expect((error as CoreValidationError).issues.some((i) => i.path === "duration.ticks")).toBe(true);
    const zeroDen = { ...asset, duration: { ticks: 1, timebase: { numerator: 24000, denominator: 0 } } };
    expect(() => parseCoreDocument("mediaAsset", zeroDen)).toThrow(CoreValidationError);
  });

  it("rejects tick and timebase values outside the safe-integer range", () => {
    const huge = { ...asset, duration: { ticks: 2 ** 53, timebase: { numerator: 24000, denominator: 1001 } } };
    expect(() => parseCoreDocument("mediaAsset", huge)).toThrow(CoreValidationError);
    const hugeRate = { ...asset, duration: { ticks: 1, timebase: { numerator: 2 ** 53, denominator: 1 } } };
    expect(() => parseCoreDocument("mediaAsset", hugeRate)).toThrow(CoreValidationError);
  });

  it("rejects documents without a schemaVersion or that are not objects", () => {
    const { schemaVersion: _v, ...noVersion } = project;
    expect(() => parseCoreDocument("project", noVersion)).toThrow(/schemaVersion/);
    expect(() => parseCoreDocument("project", "nope")).toThrow(CoreValidationError);
    expect(() => parseCoreDocument("project", null)).toThrow(CoreValidationError);
  });

  it("applies the compatibility policy and names both versions on rejection", () => {
    expect(parseCoreDocument("project", { ...project, schemaVersion: "1.0.9" }).schemaVersion).toBe("1.0.9");
    for (const version of ["1.1.0", "2.0.0", "0.9.0"]) {
      const error = catchError(() => parseCoreDocument("project", { ...project, schemaVersion: version }));
      expect(error).toBeInstanceOf(UnsupportedSchemaVersion);
      expect(error).toBeInstanceOf(CoreValidationError);
      expect((error as Error).message).toContain(version);
      expect((error as Error).message).toContain(CORE_SCHEMA_VERSION);
      expect((error as UnsupportedSchemaVersion).documentVersion).toBe(version);
      expect((error as UnsupportedSchemaVersion).supportedVersion).toBe(CORE_SCHEMA_VERSION);
    }
  });

  it("never interprets an unknown version as the current one, even when the body is valid", () => {
    expect(() => parseCoreDocument("project", { ...project, schemaVersion: "1.1.0" })).toThrow(UnsupportedSchemaVersion);
    expect(() => parseCoreDocument("project", { ...project, schemaVersion: "not-semver" })).toThrow(CoreValidationError);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected an error");
}
