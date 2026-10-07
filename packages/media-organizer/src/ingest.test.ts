import { expect, it } from "vitest";
import * as media from "./index.js";
import { id, time } from "./testing/fixtures.js";
const stamp = { size: 100n, mtimeNs: 1n };
function setup() {
  let n = 1000;
  return {
    store: media.createMemoryCatalog(media.emptyCatalog(id(100))),
    ids: () => id(n++),
    providerVersion: "probe1",
    settingsKey: "default",
    files: {
      stat: async (_uri: string) => ({ ...stamp }),
      sha256: async (_uri: string) => "a".repeat(64),
    },
    probe: {
      probe: async (_input: {
        uri: string;
      }): Promise<Record<string, unknown>> => ({
        mediaKind: "video",
        duration: time(10n),
        candidates: [],
      }),
    },
  };
}
const input = (n = 1, uri = `file:///camera${n}/A001.mov`) => ({
  scanId: id(n),
  uri,
});
it("preserves distinct assets with identical hash and same filename", async () => {
  const d = setup();
  const result = await media.ingest([input(), input(2)], d);
  const s = await d.store.read();
  expect(result.job.status).toBe("completed");
  expect(s.assets).toHaveLength(2);
  expect(s.assets[0].asset.id).not.toBe(s.assets[1].asset.id);
  expect(s.clips).toHaveLength(2);
  expect(s.scans.every((x) => x.state === "registered")).toBe(true);
});
it("never promotes partial hashes", async () => {
  const d = setup();
  d.files.sha256 = async () => "partial";
  const r = await media.ingest([input()], d);
  expect(r.items[0].state).toBe("failed");
  expect((await d.store.read()).assets).toHaveLength(0);
});
it("rejects changed file after probe", async () => {
  const d = setup();
  let reads = 0;
  d.files.stat = async () => ({ ...stamp, mtimeNs: BigInt(++reads) });
  expect((await media.ingest([input()], d)).items[0].state).toBe(
    "changed_during_read",
  );
  expect((await d.store.read()).assets).toHaveLength(0);
});
it("retains prior valid artifact on probe failure", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const before = await d.store.read();
  d.probe.probe = async () => {
    throw new Error("decoder unavailable");
  };
  d.providerVersion = "probe2";
  await media.ingest(
    [{ ...input(2, input().uri), existingAssetId: before.assets[0].asset.id }],
    d,
  );
  expect((await d.store.read()).assets[0].analysis).toEqual(
    before.assets[0].analysis,
  );
});
it("commits each completed item before cancellation", async () => {
  const d = setup();
  const controller = new AbortController();
  const original = d.store;
  d.store = {
    read: () => original.read(),
    commit: async (r, s) => {
      const saved = await original.commit(r, s);
      if (saved.assets.length === 1) controller.abort();
      return saved;
    },
  };
  const result = await media.ingest([input(), input(2)], d, {
    signal: controller.signal,
  });
  expect(result.job.status).toBe("cancelled");
  expect((await original.read()).assets).toHaveLength(1);
  expect(result.items.map((x) => x.state)).toEqual(["registered", "cancelled"]);
});
it("resumes a completed scan without importing a second asset", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const a = (await d.store.read()).assets[0].asset.id;
  expect((await media.ingest([input()], d)).items[0].state).toBe("unchanged");
  expect((await d.store.read()).assets.map((x) => x.asset.id)).toEqual([a]);
  await expect(
    media.ingest([{ ...input(), uri: "file:///another.mov" }], d),
  ).rejects.toThrow(/scan identity/);
});
it("keeps images without an invented clip duration", async () => {
  const d = setup();
  d.probe.probe = async () => ({
    mediaKind: "image",
    width: 1920,
    height: 1080,
    candidates: [],
  });
  await media.ingest([input()], d);
  const s = await d.store.read();
  expect(s.assets).toHaveLength(1);
  expect(s.clips).toHaveLength(0);
  expect(s.assets[0].probe?.width).toBe(1920);
});
it("records partial offline failure without losing successful items", async () => {
  const d = setup();
  d.files.stat = async (uri) => {
    if (uri.includes("camera2"))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { ...stamp };
  };
  const r = await media.ingest([input(), input(2)], d);
  expect(r.job.status).toBe("completed");
  expect(r.items.map((x) => x.state)).toEqual(["registered", "offline"]);
});
it("reports failed job when result commit fails, with no success item", async () => {
  const d = setup();
  const original = d.store;
  let failed = false;
  d.store = {
    read: () => original.read(),
    commit: async (r, s) => {
      if (s.assets.length && !failed) {
        failed = true;
        throw new Error("disk full");
      }
      return original.commit(r, s);
    },
  };
  const r = await media.ingest([input()], d);
  expect(r.job.status).toBe("failed");
  expect(r.items.some((x) => x.state === "registered")).toBe(false);
  d.store = original;
  const retry = await media.ingest([input()], d, { retryJobId: r.job.id });
  expect(retry.job.attempt).toBe(1);
  expect(retry.job.status).toBe("completed");
});
it("propagates a store failure when even the failed job cannot be saved", async () => {
  const d = setup();
  d.store.commit = async () => {
    throw new Error("store unavailable");
  };
  await expect(media.ingest([input()], d)).rejects.toThrow("store unavailable");
});
it("invalidates old clip ranges when source content changes", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const before = await d.store.read();
  d.files.sha256 = async () => "b".repeat(64);
  d.probe.probe = async () => ({
    mediaKind: "video",
    duration: time(5n),
    candidates: [],
  });
  await media.ingest(
    [{ ...input(2, input().uri), existingAssetId: before.assets[0].asset.id }],
    d,
  );
  const s = await d.store.read();
  expect(s.assets[0].fileRevision).toBe(2);
  expect(s.clipStates[0].reviewState).toBe("needs_review");
  expect(s.clips[0].sourceRange.duration.ticks).toBe(10n);
});

it("keeps the original asset ID after a failed reanalysis and retry", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const originalId = (await d.store.read()).assets[0].asset.id;
  d.providerVersion = "probe2";
  const probe = d.probe.probe;
  d.probe.probe = async () => {
    throw new Error("temporary decoder failure");
  };
  await media.ingest([input()], d);
  d.probe.probe = probe;
  await media.ingest([input()], d);
  expect((await d.store.read()).assets.map((x) => x.asset.id)).toEqual([
    originalId,
  ]);
});

it("does not mark a relocated asset offline when an old scan location disappears", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const state = await d.store.read();
  state.assets[0].asset.uri = "file:///relocated.mov";
  state.assets[0].locations = ["file:///relocated.mov"];
  await d.store.commit(state.revision, state);
  d.files.stat = async () => {
    throw Object.assign(new Error("old location missing"), { code: "ENOENT" });
  };
  await media.ingest([input()], d);
  expect((await d.store.read()).assets[0].availability).toBe("online");
});

it("does not use a replaced old location to overwrite a relocated asset", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const state = await d.store.read();
  state.assets[0].asset.uri = "file:///relocated.mov";
  state.assets[0].locations = ["file:///relocated.mov"];
  await d.store.commit(state.revision, state);
  d.providerVersion = "probe2";
  d.files.sha256 = async () => "b".repeat(64);
  const result = await media.ingest([input()], d);
  expect(result.items[0].state).toBe("unsupported");
  expect((await d.store.read()).assets[0].asset.fingerprint.value).toBe(
    "a".repeat(64),
  );
});
