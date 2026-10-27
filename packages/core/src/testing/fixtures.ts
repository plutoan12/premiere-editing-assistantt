/** Shared fixtures for Core tests. Not part of the public API. */
import type { Provenance } from "../analysis.js";

export const sampleProvenance: Provenance = {
  producer: { module: "@pea/media-organizer", version: "0.1.0" },
  provider: { name: "vision-provider", model: "scene-v2", version: "2.3.1" },
  prompt: { id: "scene-tagging", version: "3" },
  createdAt: "2026-10-27T00:00:00.000Z",
  inputFingerprints: ["a".repeat(64)],
  configHash: "c".repeat(64),
};
