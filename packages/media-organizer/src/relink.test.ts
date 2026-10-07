import { expect, it } from "vitest";
import * as media from "./index.js";
import { id, assetRecord, clip } from "./testing/fixtures.js";
const fixture = (): media.CatalogState => ({
  ...media.emptyCatalog(id(100)),
  assets: [assetRecord()],
  clips: [clip()],
});
const request = {
  mediaAssetId: id(1),
  fromUri: "file:///shoot/A001.mov",
  toUri: "file:///new/A001.mov",
  expectedFileRevision: 1,
};
const files = () => ({
  stat: async (_uri: string) => ({ size: 100n, mtimeNs: 1n }),
  sha256: async (_uri: string) => "a".repeat(64),
});
it("preserves identity and user values when location changes", async () => {
  let s = media.setMetadataOverride(
    fixture(),
    { kind: "asset", id: id(1) },
    "deviceId",
    "A",
  );
  const store = media.createMemoryCatalog(s);
  expect((await media.prepareRelink(s, request, files())).status).toBe(
    "verified",
  );
  s = await media.commitRelink(store, request, files());
  expect(s.assets[0].asset.uri).toBe(request.toUri);
  expect(s.assets[0].asset.id).toBe(id(1));
  expect(s.clips[0].id).toBe(id(2));
  expect(s.metadata[0].override?.value).toBe("A");
});
it("requires confirmation for case-folding ambiguity", async () => {
  const s = fixture();
  s.assets.push(assetRecord(4, "file:///NEW/A001.mov"));
  expect((await media.prepareRelink(s, request, files())).status).toBe(
    "ambiguous",
  );
  const store = media.createMemoryCatalog(s);
  await expect(media.commitRelink(store, request, files())).rejects.toThrow(
    /ambiguous/,
  );
  expect((await store.read()).revision).toBe(0);
});
it("rehashes at commit and rejects changed source content or stale revision", async () => {
  const s = fixture(),
    store = media.createMemoryCatalog(s),
    f = files();
  await media.prepareRelink(s, request, f);
  f.sha256 = async () => "b".repeat(64);
  await expect(media.commitRelink(store, request, f)).rejects.toThrow(
    /mismatch/,
  );
  await expect(
    media.commitRelink(store, { ...request, expectedFileRevision: 2 }, files()),
  ).rejects.toThrow(/revision/);
});
it("rejects files changing during verification and keeps offline failures explicit", async () => {
  const f = files();
  let n = 0;
  f.stat = async () => ({ size: 100n, mtimeNs: BigInt(++n) });
  expect((await media.prepareRelink(fixture(), request, f)).status).toBe(
    "mismatch",
  );
  f.stat = async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  expect((await media.prepareRelink(fixture(), request, f)).status).toBe(
    "offline",
  );
});
