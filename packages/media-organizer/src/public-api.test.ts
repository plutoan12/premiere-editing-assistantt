import { expect, it } from "vitest";
import { MediaDocumentSchema } from "@pea/core";
import {
  emptyCatalog,
  createMemoryCatalog,
  ingest,
  exportCatalog,
  importCatalog,
} from "@pea/media-organizer";
import { id, time } from "./testing/fixtures.js";
it("produces Core media records through package public exports", async () => {
  let n = 100;
  const store = createMemoryCatalog(emptyCatalog(id(1)));
  await ingest([{ scanId: id(2), uri: "file:///sound.wav" }], {
    store,
    ids: () => id(n++),
    providerVersion: "fixture",
    settingsKey: "default",
    files: {
      stat: async () => ({ size: 100n, mtimeNs: 1n }),
      sha256: async () => "f".repeat(64),
    },
    probe: {
      probe: async () => ({
        mediaKind: "audio",
        audioChannels: 2,
        duration: time(48000n, 48000),
        candidates: [],
      }),
    },
  });
  const state = importCatalog(exportCatalog(await store.read()));
  const document = MediaDocumentSchema.parse({
    schemaVersion: "1.0.0",
    kind: "media",
    data: { assets: state.assets.map((x) => x.asset), clips: state.clips },
  });
  expect(document.data.clips[0].mediaAssetId).toBe(document.data.assets[0].id);
  expect(document.data.assets[0].readOnly).toBe(true);
});
