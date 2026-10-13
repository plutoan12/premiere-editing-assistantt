import { describe, expect, it } from "vitest";
import { CORE_SCHEMA_VERSION } from "./version.js";

describe("core schema version", () => {
  it("starts at 1.0.0", () => {
    expect(CORE_SCHEMA_VERSION).toBe("1.0.0");
  });
});
