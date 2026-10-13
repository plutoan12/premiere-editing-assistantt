import { bench } from "vitest";
import { randomUUID } from "node:crypto";
import {
  emptyCatalog,
  defaultRuleSet,
  createSearchIndex,
} from "@pea/media-organizer";
import { preparePreview } from "./preview.js";
const state = emptyCatalog(randomUUID()),
  rules = defaultRuleSet(randomUUID());
for (let i = 0; i < 500; i++) {
  const id = randomUUID(),
    uri = `file:///camera/샘플_${i}.mov`;
  state.assets.push({
    asset: {
      id,
      uri,
      readOnly: true,
      fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
    },
    fileRevision: 1,
    locations: [uri],
    availability: "online",
    sourceState: "verified",
  });
}
const index = createSearchIndex();
await index.rebuild(state);
const preview = preparePreview(state, rules);
bench(
  "prepare 500 file previews after catalog changes",
  () => {
    void preparePreview(state, rules);
  },
  { iterations: 10, time: 0 },
);
bench(
  "search and format 500 cached previews on query input",
  () => {
    const hits = index.search({ text: "샘플", filters: {} });
    void hits.map((hit) => {
      const row = preview.get(hit.mediaAssetId)!;
      return [
        row.filename,
        row.pathSegments.join(" / "),
        row.issues.join(", "),
        row.uri,
      ].join("\n");
    });
  },
  { iterations: 200, time: 0 },
);
