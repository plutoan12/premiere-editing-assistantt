import { describe, expect, it } from "vitest";
import { CoreValidationError, UnsupportedSchemaVersion, parseCoreDocument } from "./validation.js";
import { CORE_SCHEMA_VERSION, isSchemaVersionSupported } from "./version.js";

const project = (schemaVersion: string) => ({
  schemaVersion,
  kind: "project",
  data: { schemaVersion, id: "p1", name: "Demo", createdAt: "2026-10-03T00:00:00.000Z" },
});

describe("schema version policy", () => {
  it("accepts the same major with a lower or equal minor and ignores patch", () => {
    expect(isSchemaVersionSupported("1.0.0", "1.0.0")).toBe(true);
    expect(isSchemaVersionSupported("1.0.7", "1.0.0")).toBe(true);
    expect(isSchemaVersionSupported("1.2.5", "1.3.0")).toBe(true);
  });
  it("rejects a different major, a higher minor and malformed versions", () => {
    expect(isSchemaVersionSupported("1.1.0", "1.0.0")).toBe(false);
    expect(isSchemaVersionSupported("2.0.0", "1.3.0")).toBe(false);
    expect(isSchemaVersionSupported("0.9.0", "1.0.0")).toBe(false);
    expect(isSchemaVersionSupported("1.0", "1.0.0")).toBe(false);
    expect(isSchemaVersionSupported("v1.0.0", "1.0.0")).toBe(false);
  });
});

describe("core document validation", () => {
  it("accepts a v1 project", () => {
    expect(parseCoreDocument(project("1.0.0")).kind).toBe("project");
  });

  it("accepts a same-major patch bump and rejects a higher minor or major explicitly", () => {
    expect(parseCoreDocument(project("1.0.9")).kind).toBe("project");
    for (const version of ["1.1.0", "2.0.0", "0.9.0", "9.0.0"]) {
      let caught: unknown;
      try {
        parseCoreDocument(project(version));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnsupportedSchemaVersion);
      expect(caught).toBeInstanceOf(CoreValidationError);
      expect((caught as Error).message).toMatch(/Unsupported schema version/);
      expect((caught as Error).message).toContain(version);
      expect((caught as Error).message).toContain(CORE_SCHEMA_VERSION);
      expect((caught as UnsupportedSchemaVersion).documentVersion).toBe(version);
    }
  });

  it("rejects unknown schema versions", () => {
    expect(() => parseCoreDocument({ schemaVersion: "9.0.0", kind: "project", data: {} })).toThrow(/Unsupported schema version/);
    expect(() => parseCoreDocument({ schemaVersion: "not-semver", kind: "project", data: {} })).toThrow(/Unsupported schema version/);
  });

  it("rejects unknown document kinds", () => {
    expect(() => parseCoreDocument({ schemaVersion: "1.0.0", kind: "mystery", data: {} })).toThrow(/Unsupported document kind/);
  });

  it("applies the policy to media documents as well", () => {
    const media = { schemaVersion: "1.0.3", kind: "media", data: { assets: [], clips: [] } };
    expect(parseCoreDocument(media).kind).toBe("media");
    expect(() => parseCoreDocument({ ...media, schemaVersion: "1.1.0" })).toThrow(UnsupportedSchemaVersion);
  });
});
