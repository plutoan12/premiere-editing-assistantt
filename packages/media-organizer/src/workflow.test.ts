import { expect, it } from "vitest";
import * as media from "./index.js";
import { id, time } from "./testing/fixtures.js";
import { testEditor } from "./testing/editor.js";
it("registers, overrides, classifies, searches and reviews a portable catalog", async () => {
  const store = media.createMemoryCatalog(media.emptyCatalog(id(100)));
  let next = 1000;
  const result = await media.ingest(
    [1, 2, 3].map((n) => ({
      scanId: id(n),
      uri: `file:///camera${n}/서울_인터뷰.mov`,
    })),
    {
      store,
      ids: () => id(next++),
      providerVersion: "fixture-1",
      settingsKey: "default",
      files: {
        stat: async (uri) => {
          if (uri.includes("camera3"))
            throw Object.assign(new Error("offline"), { code: "ENOENT" });
          return { size: 100n, mtimeNs: 1n };
        },
        sha256: async () => "a".repeat(64),
      },
      probe: {
        probe: async () => ({
          mediaKind: "video",
          duration: time(10n),
          candidates: [],
        }),
      },
    },
  );
  expect(result.items.map((x) => x.state)).toEqual([
    "registered",
    "registered",
    "offline",
  ]);
  let state = await store.read();
  for (const [i, asset] of state.assets.entries()) {
    const target = { kind: "asset" as const, id: asset.asset.id };
    state = media.setMetadataOverride(
      state,
      target,
      "captureDate",
      "2026-10-03",
    );
    state = media.setMetadataOverride(state, target, "deviceId", `CAM_${i}`);
    state = media.upsertAnnotation(state, {
      id: id(90 + i),
      target,
      kind: "tag",
      value: "인터뷰",
      origin: "user",
      reviewState: "confirmed",
    });
  }
  const rules = media.defaultRuleSet(id(500));
  state.ruleSets.push(rules);
  state.bindings = state.clips.map((c, i) => ({
    bindingId: id(600 + i),
    clipId: c.id,
    adapterId: "test-hierarchy",
    hostProjectKey: "p1",
    hostItemId: `item${i}`,
    hostRevision: "1",
  }));
  state = await store.commit(state.revision, state);
  const features = Object.fromEntries(
    [
      "hierarchy",
      "tags",
      "import",
      "projectFields",
      "reveal",
      "rangeReveal",
      "undo",
    ].map((x) => [x, { status: "supported", reason: "test host" }]),
  ) as media.CapabilityReport["features"];
  const context: media.HostContext = {
    adapterId: "test-hierarchy",
    hostProjectKey: "p1",
    hostRevision: "1",
    catalogRevision: state.revision,
    bindings: state.bindings,
    items: state.bindings.map((b) => ({
      hostItemId: b.hostItemId,
      kind: "clip",
      itemRevision: "1",
      metadata: [],
      sourceRange: { start: time(0n), duration: time(10n) },
    })),
    capabilities: {
      editor: "test-hierarchy",
      appVersion: "1",
      os: "test",
      adapterVersion: "1",
      revision: "1",
      features,
    },
  };
  const targets = state.clips.map((c) => ({ kind: "clip" as const, id: c.id }));
  const org = media.buildOrganizationPlan(state, targets, rules, [], () =>
    id(650),
  );
  expect(org.assignments.map((x) => x.pathSegments)).toEqual([
    ["Media Organizer", "2026-10-03", "CAM_0", "Video"],
    ["Media Organizer", "2026-10-03", "CAM_1", "Video"],
  ]);
  const adapter = testEditor(context),
    host = await adapter.planApply(org, context);
  state = await media.saveReviewedPlan(store, org, host);
  const encoded = media.exportCatalog(state),
    restored = media.importCatalog(encoded);
  expect(restored).toEqual(state);
  expect(
    restored.hostPlans[0].expectedContext.items[0].sourceRange?.duration.ticks,
  ).toBe(10n);
  const index = media.createSearchIndex();
  await index.rebuild(restored);
  expect(
    index
      .search({
        text: "서울 인터",
        filters: { deviceId: "CAM_1", tags: ["인터뷰"] },
      })
      .map((x) => x.target.id),
  ).toEqual([state.clips[1].id]);
  const pending = await adapter.apply(
    state.hostPlans[0] as media.HostApplyPlan<{ path: string[] }>,
  );
  expect(pending.status).toBe("partial");
  const verified = await adapter.verify(pending);
  expect(verified.status).toBe("verified_applied");
  state.receipts.push(verified);
  state = await store.commit(state.revision, state);
  expect(
    media.importCatalog(media.exportCatalog(state)).receipts[0].status,
  ).toBe("verified_applied");
  const tagsOnly = testEditor(context, false),
    loss = await tagsOnly.planApply(org, context);
  expect(media.preflight(loss, context).ok).toBe(false);
  expect((await store.read()).annotations).toHaveLength(2);
});
