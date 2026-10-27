import { describe, expect, it } from "vitest";
import { assertEntityId, isEntityId, newEntityId } from "./ids.js";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("EntityId", () => {
  it("generates lowercase UUID v7 strings", () => {
    const id = newEntityId();
    expect(id).toMatch(UUID_V7);
    expect(isEntityId(id)).toBe(true);
  });

  it("is time-ordered: generation order equals lexicographic order", () => {
    const ids = Array.from({ length: 2000 }, () => newEntityId());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stays monotonic when the clock goes backwards", () => {
    let now = 1_800_000_000_000;
    const clock = () => now;
    const a = newEntityId(clock);
    now -= 10_000;
    const b = newEntityId(clock);
    expect(a < b).toBe(true);
  });

  it("rejects non-v7 UUIDs, uppercase and arbitrary strings", () => {
    expect(isEntityId("3b241101-e2bb-4b9e-8a5c-7a9b3e1f2c4d")).toBe(false); // v4
    expect(isEntityId(newEntityId().toUpperCase())).toBe(false);
    expect(isEntityId("/Volumes/Media/clip.mov")).toBe(false);
    expect(isEntityId(42)).toBe(false);
    expect(() => assertEntityId("not-an-id")).toThrow();
  });
});
