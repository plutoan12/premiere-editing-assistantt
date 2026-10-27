import { describe, expect, it } from "vitest";
import { CORE_SCHEMA_VERSION } from "./version.js";

describe("CORE_SCHEMA_VERSION", () => {
  it("is the v1 baseline", () => {
    expect(CORE_SCHEMA_VERSION).toBe("1.0.0");
  });
});
