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

it("reanalyses a duplicate request when its source stamp changed", async () => {
  const d = setup();
  let reads = 0,
    hashes = 0;
  d.files.stat = async () => ({ ...stamp, mtimeNs: ++reads <= 2 ? 1n : 2n });
  d.files.sha256 = async () => (++hashes === 1 ? "a" : "b").repeat(64);
  const r = await media.ingest([input(), input(2, input().uri)], d);
  const s = await d.store.read();
  expect(hashes).toBe(2);
  expect(s.assets).toHaveLength(1);
  expect(s.assets[0].asset.fingerprint.value).toBe("b".repeat(64));
  expect(s.assets[0].fileRevision).toBe(2);
  expect(r.items[1].assetId).toBe(r.items[0].assetId);
  await media.ingest([input(2, input().uri)], d);
  expect(hashes).toBe(2);
});

it("reuses a stable duplicate without hashing again", async () => {
  const d = setup();
  let hashes = 0;
  d.files.sha256 = async () => {
    hashes++;
    return "a".repeat(64);
  };
  const r = await media.ingest([input(), input(2, input().uri)], d);
  expect(hashes).toBe(1);
  expect(r.items.map((x) => x.state)).toEqual(["registered", "unchanged"]);
  expect((await d.store.read()).assets).toHaveLength(1);
});

it("blocks changed sources after failed probing while preserving user data", async () => {
  const d = setup();
  await media.ingest([input()], d);
  let before = await d.store.read();
  const target = { kind: "clip" as const, id: before.clips[0].id };
  before = media.upsertAnnotation(before, {
    id: id(70),
    target,
    kind: "note",
    value: "keep this range",
    range: before.clips[0].sourceRange,
    origin: "user",
    reviewState: "confirmed",
  });
  before = await d.store.commit(before.revision, before);
  const probe = d.probe.probe;
  d.files.stat = async () => ({ ...stamp, mtimeNs: 2n });
  d.files.sha256 = async () => "b".repeat(64);
  d.probe.probe = async () => {
    throw new Error("decoder unavailable");
  };
  const result = await media.ingest([input()], d);
  const s = await d.store.read();
  const rules = { ...media.defaultRuleSet(id(80)), orderedFields: [] };
  const targets = [
    target,
    { kind: "asset" as const, id: s.assets[0].asset.id },
  ];
  expect(result.items[0].state).toBe("failed");
  expect(
    media.buildOrganizationPlan(s, targets, rules, targets, d.ids).assignments,
  ).toEqual([]);
  expect(s.assets[0].analysis).toEqual(before.assets[0].analysis);
  expect(s.clips).toEqual(before.clips);
  expect(s.clipStates[0].reviewState).toBe("needs_review");
  expect(s.annotations[0]).toMatchObject({
    value: "keep this range",
    reviewState: "needs_review",
  });
  d.probe.probe = probe;
  await media.ingest([input()], d);
  const recovered = await d.store.read();
  expect(recovered.assets[0].fileRevision).toBe(2);
  expect(
    media.buildOrganizationPlan(recovered, [targets[1]], rules, [], d.ids)
      .assignments,
  ).toHaveLength(1);
  expect(
    media.buildOrganizationPlan(recovered, [target], rules, [], d.ids)
      .assignments,
  ).toEqual([]);
});

it("does not reuse a historical scan after an unstable failed read", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const originalId = (await d.store.read()).assets[0].asset.id;
  let reads = 0;
  d.files.stat = async () => ({ ...stamp, mtimeNs: BigInt(++reads) });
  const failed = await media.ingest(
    [{ ...input(2, input().uri), existingAssetId: originalId }],
    d,
  );
  expect(failed.items[0].state).toBe("changed_during_read");
  const s = await d.store.read();
  const rules = { ...media.defaultRuleSet(id(80)), orderedFields: [] };
  const target = { kind: "asset" as const, id: originalId };
  expect(
    media.buildOrganizationPlan(s, [target], rules, [], d.ids).assignments,
  ).toEqual([]);
  d.files.stat = async () => ({ ...stamp });
  let hashes = 0;
  d.files.sha256 = async () => {
    hashes++;
    return "a".repeat(64);
  };
  await media.ingest([input()], d);
  expect(hashes).toBe(1);
});

it.each(["providerVersion", "settingsKey"] as const)(
  "binds completed scans to the current analysis %s",
  async (key) => {
    const d = setup();
    let probes = 0;
    const probe = d.probe.probe;
    d.probe.probe = async (x) => {
      probes++;
      return probe(x);
    };
    await media.ingest([input()], d);
    const originalId = (await d.store.read()).assets[0].asset.id;
    const first = d[key];
    d[key] = "v2";
    await media.ingest(
      [{ ...input(2, input().uri), existingAssetId: originalId }],
      d,
    );
    d[key] = first;
    await media.ingest([input()], d);
    expect(probes).toBe(3);
    expect((await d.store.read()).assets[0].analysis?.[key]).toBe(first);
  },
);

it("invalidates an old scan when another scan replaced its analysis generation", async () => {
  const d = setup();
  let hashes = 0;
  d.files.sha256 = async () => {
    hashes++;
    return "a".repeat(64);
  };
  await media.ingest([input()], d);
  const originalId = (await d.store.read()).assets[0].asset.id;
  await media.ingest(
    [{ ...input(2, input().uri), existingAssetId: originalId }],
    d,
  );
  await media.ingest([input()], d);
  expect(hashes).toBe(3);
});

it("invalidates an old scan when another scan changed the asset revision", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const originalId = (await d.store.read()).assets[0].asset.id;
  d.files.stat = async () => ({ ...stamp, mtimeNs: 2n });
  d.files.sha256 = async () => "b".repeat(64);
  await media.ingest(
    [{ ...input(2, input().uri), existingAssetId: originalId }],
    d,
  );
  d.files.stat = async () => ({ ...stamp });
  d.files.sha256 = async () => "a".repeat(64);
  await media.ingest([input()], d);
  const s = await d.store.read();
  expect(s.assets[0].asset.fingerprint.value).toBe("a".repeat(64));
  expect(s.assets[0].fileRevision).toBe(3);
});

it("restores availability when a verified unchanged source returns", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const originalId = (await d.store.read()).assets[0].asset.id;
  d.files.stat = async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  await media.ingest(
    [{ ...input(2, input().uri), existingAssetId: originalId }],
    d,
  );
  expect((await d.store.read()).assets[0].availability).toBe("offline");
  d.files.stat = async () => ({ ...stamp });
  const r = await media.ingest([input()], d);
  expect(r.items[0].state).toBe("unchanged");
  const s = await d.store.read();
  expect(s.assets[0].availability).toBe("online");
  const target = { kind: "clip" as const, id: s.clips[0].id };
  expect(
    media.buildOrganizationPlan(
      s,
      [target],
      { ...media.defaultRuleSet(id(80)), orderedFields: [] },
      [],
      d.ids,
    ).assignments,
  ).toHaveLength(1);
});

it.each(["canonical", "mirror"] as const)(
  "keeps only the verified location after replacing the %s contents",
  async (location) => {
    const d = setup();
    await media.ingest([input()], d);
    let s = await d.store.read();
    const assetId = s.assets[0].asset.id;
    const canonical = input().uri,
      mirror = "file:///backup/A001.mov";
    s.assets[0].locations.push(mirror);
    s = media.setMetadataOverride(
      s,
      { kind: "asset", id: assetId },
      "deviceId",
      "CAM_A",
    );
    await d.store.commit(s.revision, s);
    const replaced = location === "canonical" ? canonical : mirror;
    const previous = location === "canonical" ? mirror : canonical;
    d.files.sha256 = async (uri) => (uri === replaced ? "b" : "a").repeat(64);
    await media.ingest(
      [{ ...input(2, replaced), existingAssetId: assetId }],
      d,
    );
    const after = await d.store.read();
    expect(after.assets[0].locations).toEqual([replaced]);
    expect(after.assets[0].asset).toMatchObject({
      id: assetId,
      uri: replaced,
      fingerprint: { value: "b".repeat(64) },
    });
    expect(after.assets[0].fileRevision).toBe(2);
    expect(after.clips).toEqual(s.clips);
    expect(
      media.effectiveMetadata({ kind: "asset", id: assetId }, after, "deviceId")
        .value,
    ).toBe("CAM_A");
    await expect(
      media.ingest([{ ...input(3, previous), existingAssetId: assetId }], d),
    ).rejects.toThrow(/location/);
    if (location === "mirror") {
      expect((await media.ingest([input()], d)).items[0].state).toBe(
        "unsupported",
      );
    }
    await media.ingest([input(4, previous)], d);
    const separate = await d.store.read();
    expect(separate.assets).toHaveLength(2);
    expect(separate.assets[0].asset.fingerprint.value).toBe("b".repeat(64));
    expect(separate.assets[0].fileRevision).toBe(2);
    expect(separate.assets[1].asset.fingerprint.value).toBe("a".repeat(64));
  },
);

it("preserves verified mirrors when a rescan confirms the same contents", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const before = await d.store.read();
  const mirror = "file:///backup/A001.mov";
  before.assets[0].locations.push(mirror);
  await d.store.commit(before.revision, before);
  await media.ingest(
    [{ ...input(2, mirror), existingAssetId: before.assets[0].asset.id }],
    d,
  );
  const after = await d.store.read();
  expect(after.assets[0].locations).toEqual(before.assets[0].locations);
  expect(after.assets[0].asset.uri).toBe(input().uri);
  expect(after.assets[0].fileRevision).toBe(1);
});

it("reports and persists content updates while resumed results remain unchanged", async () => {
  const d = setup();
  let hash = "a".repeat(64),
    hashes = 0;
  d.files.sha256 = async () => {
    hashes++;
    return hash;
  };
  await media.ingest([input()], d);
  hash = "b".repeat(64);
  d.files.stat = async () => ({ ...stamp, mtimeNs: 2n });
  const changed = await media.ingest([input()], d);
  expect(changed.items[0].state).toBe("updated");
  const state = await d.store.read();
  expect(state.scans[0].state).toBe("updated");
  expect(state.scans[0].result?.state).toBe("updated");
  expect(
    state.jobs.find((x) => x.job.id === changed.job.id)?.items[0].state,
  ).toBe("updated");
  expect(state.assets[0].fileRevision).toBe(2);
  // The new result state must survive exchange and remain a reusable success.
  d.store = media.createMemoryCatalog(
    media.importCatalog(media.exportCatalog(state)),
  );
  const resumed = await media.ingest([input()], d);
  expect(resumed.items[0].state).toBe("unchanged");
  expect(hashes).toBe(2);
  expect((await d.store.read()).assets[0].fileRevision).toBe(2);
  d.providerVersion = "probe2";
  expect((await media.ingest([input()], d)).items[0].state).toBe("unchanged");
  expect(hashes).toBe(3);
});

it("reports a content update once when duplicate requests share its result", async () => {
  const d = setup();
  await media.ingest([input()], d);
  const assetId = (await d.store.read()).assets[0].asset.id;
  let hashes = 0;
  d.files.sha256 = async () => {
    hashes++;
    return "b".repeat(64);
  };
  const changed = await media.ingest(
    [
      { ...input(2, input().uri), existingAssetId: assetId },
      { ...input(3, input().uri), existingAssetId: assetId },
    ],
    d,
  );
  expect(changed.items.map((x) => x.state)).toEqual(["updated", "unchanged"]);
  expect(hashes).toBe(1);
  expect((await d.store.read()).assets[0].fileRevision).toBe(2);
});
