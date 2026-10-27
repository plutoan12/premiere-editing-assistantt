import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJsonSchemas } from "./schemas.js";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schemas", "v1");

describe("schemas/v1", () => {
  it("has a committed JSON Schema for every Core schema bundle and no stragglers", () => {
    const generated = buildJsonSchemas();
    const expectedFiles = Object.keys(generated)
      .map((name) => `${name}.schema.json`)
      .sort();
    expect(readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json")).sort()).toEqual(expectedFiles);
    expect(expectedFiles).toEqual(["analysis.schema.json", "artifact.schema.json", "edit.schema.json", "job.schema.json", "media.schema.json", "project.schema.json", "sync.schema.json", "transcript.schema.json"]);
  });

  it("matches the Zod definitions exactly (run `pnpm schemas:generate` after changing a contract)", () => {
    for (const [name, schema] of Object.entries(buildJsonSchemas())) {
      const committed = JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), "utf8")) as unknown;
      expect(committed, `${name}.schema.json is out of date`).toEqual(schema);
    }
  });

  it("encodes the time model constraints: integer ticks within the safe range and reduced rationals", () => {
    const media = buildJsonSchemas()["media"] as { properties: { duration: { properties: { ticks: Record<string, unknown> } } } };
    expect(media.properties.duration.properties.ticks).toMatchObject({ type: "integer", minimum: -(2 ** 53 - 1), maximum: 2 ** 53 - 1 });
  });
});
