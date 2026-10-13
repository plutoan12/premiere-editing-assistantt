import { expect, it } from "vitest";
import {
  emptyCatalog,
  defaultRuleSet,
  setMetadataOverride,
} from "@pea/media-organizer";
import { randomUUID } from "node:crypto";
import { preparePreview } from "./preview.js";
it("keeps per-file review reasons and classifications in a reusable catalog snapshot", () => {
  let state = emptyCatalog(randomUUID());
  const a = randomUUID(),
    b = randomUUID();
  for (const id of [a, b])
    state.assets.push({
      asset: {
        id,
        uri: `file:///source/${id}.mov`,
        readOnly: true,
        fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
      },
      fileRevision: 1,
      locations: [`file:///source/${id}.mov`],
      availability: "online",
      sourceState: "verified",
    });
  for (const id of [a, b])
    state = setMetadataOverride(
      state,
      { kind: "asset", id },
      "mediaKind",
      "video",
    );
  state.assets[1].sourceState = "unverified";
  const rules = defaultRuleSet(randomUUID());
  rules.orderedFields = ["mediaKind"];
  const rows = preparePreview(state, rules);
  expect(rows.get(a)?.pathSegments).toEqual(["Media Organizer", "Video"]);
  expect(rows.get(a)?.issues).toEqual([]);
  expect(rows.get(b)?.issues).toEqual(["source_unverified"]);
  // Query rendering consumes immutable prepared rows; a future catalog mutation
  // cannot silently rewrite the currently displayed verified snapshot.
  state.assets[0].asset.uri = "file:///changed.mov";
  expect(rows.get(a)?.uri).toContain(a);
});
