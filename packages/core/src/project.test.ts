import { describe, expect, it } from "vitest";
import { CORE_SCHEMA_VERSION } from "./version.js";
import { FPS_23_976 } from "./time.js";
import { ProjectSchema, createProject } from "./project.js";

describe("Project", () => {
  it("creates a valid project with a stable id, explicit frame rate and timestamps", () => {
    const p = createProject({ name: "Doc", frameRate: FPS_23_976 }, () => new Date("2026-10-27T00:00:00Z"));
    expect(ProjectSchema.parse(p)).toEqual(p);
    expect(p.schemaVersion).toBe(CORE_SCHEMA_VERSION);
    expect(p.frameRate).toEqual({ numerator: 24000, denominator: 1001 });
    expect(p.createdAt).toBe("2026-10-27T00:00:00.000Z");
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a missing or non-rational frame rate", () => {
    const p = createProject({ name: "Doc", frameRate: FPS_23_976 });
    expect(ProjectSchema.safeParse({ ...p, frameRate: 23.976 }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...p, frameRate: { numerator: 24000, denominator: 0 } }).success).toBe(false);
    const { frameRate: _omit, ...withoutRate } = p;
    expect(ProjectSchema.safeParse(withoutRate).success).toBe(false);
  });

  it("keeps NLE references adapter-owned and separate from the id", () => {
    const p = createProject({ name: "Doc", frameRate: FPS_23_976, nleRefs: { premiere: "proj-123" } });
    expect(ProjectSchema.parse(p).nleRefs).toEqual({ premiere: "proj-123" });
    expect(ProjectSchema.safeParse({ ...p, id: "proj-123" }).success).toBe(false);
  });

  it("rejects unknown keys so private state cannot leak through the contract", () => {
    const p = createProject({ name: "Doc", frameRate: FPS_23_976 });
    expect(ProjectSchema.safeParse({ ...p, premiereInternal: {} }).success).toBe(false);
  });
});
