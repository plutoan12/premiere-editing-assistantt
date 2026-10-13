import { bench, describe } from "vitest";
import { cpus, platform, arch } from "node:os";
import {
  emptyCatalog,
  createSearchIndex,
  type CatalogState,
  type SearchQuery,
} from "./index.js";
import { id, assetRecord, clip } from "./testing/fixtures.js";
const state: CatalogState = emptyCatalog(id(9999));
for (let i = 0; i < 500; i++) {
  const a = 100 + i,
    c = 1000 + i,
    target = { kind: "asset" as const, id: id(a) };
  state.assets.push(assetRecord(a, `file:///day${i % 3}/서울_인터뷰_${i}.mov`));
  state.clips.push(clip(c, a));
  for (const [field, value] of [
    ["deviceId", `CAM_${i % 5}`],
    ["captureDate", `2026-10-0${(i % 3) + 1}`],
    ["mediaKind", "video"],
  ] as const)
    state.metadata.push({
      target,
      field,
      candidates: [],
      override: { value, locked: true },
    });
  state.annotations.push({
    id: id(2000 + i),
    target,
    kind: "tag",
    value: i % 2 ? "인물" : "야외",
    origin: "user",
    reviewState: "confirmed",
  });
}
const index = createSearchIndex();
await index.rebuild(state);
const query = (i: number): SearchQuery => ({
  text: i % 2 ? "서울 인터" : "",
  filters: { deviceId: `CAM_${i % 5}`, tags: [i % 2 ? "인물" : "야외"] },
});
for (let i = 0; i < 20; i++) index.search(query(i));
const samples: number[] = [];
for (let i = 0; i < 200; i++) {
  const start = performance.now();
  index.search(query(i));
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(
  "MEDIA_SEARCH_BENCHMARK " +
    JSON.stringify({
      items: 500,
      warmup: 20,
      samples: 200,
      p50Ms: samples[99],
      p95Ms: samples[189],
      p99Ms: samples[197],
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
    }),
);
describe("indexed catalog search", () => {
  bench(
    "500 clips, Korean text and camera/tag filters",
    () => {
      index.search(query(1));
    },
    { time: 250, iterations: 200, warmupTime: 0, warmupIterations: 20 },
  );
});
