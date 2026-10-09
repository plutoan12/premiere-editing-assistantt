import { expect, it } from "vitest";
import * as media from "./index.js";
import { id, assetRecord, clip, time } from "./testing/fixtures.js";
const target = { kind: "clip" as const, id: id(2) };
const fixture = (): media.CatalogState => ({
  ...media.emptyCatalog(id(100)),
  assets: [assetRecord()],
  clips: [clip()],
});
it("builds deterministic previews without mutating the catalog", () => {
  const s = fixture(),
    rules = media.defaultRuleSet(id(50));
  rules.orderedFields = [];
  const before = structuredClone(s);
  const p = media.buildOrganizationPlan(s, [target, target], rules, [], () =>
    id(60),
  );
  expect(p.assignments).toEqual([
    { target, pathSegments: ["Media Organizer"], tags: [] },
  ]);
  expect(s).toEqual(before);
});
it("excludes conflicts even when unknown classifications are accepted", () => {
  const s = fixture(),
    rules = media.defaultRuleSet(id(50));
  rules.orderedFields = ["deviceId"];
  const unknown = media.buildOrganizationPlan(
    s,
    [target],
    rules,
    [target],
    () => id(60),
  );
  expect(unknown.assignments).toHaveLength(1);
  rules.pathMappings = [
    { prefix: "file:///shoot", deviceId: "A" },
    { prefix: "file:///shoot", deviceId: "B" },
  ];
  const conflict = media.buildOrganizationPlan(
    s,
    [target],
    rules,
    [target],
    () => id(60),
  );
  expect(conflict.assignments).toHaveLength(0);
  expect(conflict.issues[0].code).toBe("conflict");
});
it("blocks stale source ranges and offline media even with accepted unknowns", () => {
  const s = fixture(),
    rules = media.defaultRuleSet(id(50));
  rules.orderedFields = [];
  s.assets[0].fileRevision = 2;
  s.clipStates = [
    { clipId: id(2), fileRevision: 1, reviewState: "needs_review" },
  ];
  expect(
    media.buildOrganizationPlan(s, [target], rules, [target], () => id(60))
      .issues[0].code,
  ).toBe("source_changed");
  s.clipStates = [];
  s.assets[0].availability = "offline";
  expect(
    media.buildOrganizationPlan(s, [target], rules, [target], () => id(60))
      .issues[0].code,
  ).toBe("offline");
});
it("persists reviewed plans against the resulting revision and rejects stale review", async () => {
  const s = fixture(),
    rules = media.defaultRuleSet(id(50));
  rules.orderedFields = [];
  s.ruleSets.push(rules);
  const store = media.createMemoryCatalog(s),
    org = media.buildOrganizationPlan(s, [target], rules, [], () => id(60));
  const features = Object.fromEntries(
    [
      "hierarchy",
      "tags",
      "import",
      "projectFields",
      "reveal",
      "rangeReveal",
      "undo",
    ].map((x) => [x, { status: "supported", reason: "test" }]),
  ) as media.CapabilityReport["features"];
  const host: media.HostApplyPlan = {
    id: id(61),
    organizationPlanId: org.id,
    adapterSchemaVersion: "1",
    expectedContext: {
      adapterId: "test",
      hostProjectKey: "p",
      hostRevision: "r",
      catalogRevision: 0,
      capabilities: {
        editor: "test",
        appVersion: "1",
        os: "test",
        adapterVersion: "1",
        revision: "1",
        features,
      },
      bindings: [],
      items: [],
    },
    operations: [],
    compatibilityReport: [],
  };
  const saved = await media.saveReviewedPlan(store, org, host);
  expect(saved.hostPlans[0].expectedContext.catalogRevision).toBe(1);
  await expect(media.saveReviewedPlan(store, org, host)).rejects.toThrow(
    /revision/,
  );
});

it.each(["asset", "clip"] as const)(
  "plans only confirmed whole-item tags for a %s",
  (kind) => {
    let s = fixture();
    const assetTarget = { kind: "asset" as const, id: id(1) };
    const selected = kind === "asset" ? assetTarget : target;
    const annotations: media.Annotation[] = [
      {
        id: id(70),
        target: assetTarget,
        kind: "tag",
        value: "whole-asset",
        origin: "user",
        reviewState: "confirmed",
      },
      {
        id: id(71),
        target: assetTarget,
        kind: "tag",
        value: "first-two-seconds",
        range: { start: time(0n), duration: time(2n) },
        origin: "user",
        reviewState: "confirmed",
      },
      {
        id: id(72),
        target: assetTarget,
        kind: "tag",
        value: "needs-confirmation",
        origin: "user",
        reviewState: "needs_review",
      },
      {
        id: id(73),
        target: target,
        kind: "tag",
        value: "whole-clip",
        origin: "user",
        reviewState: "confirmed",
      },
      {
        id: id(74),
        target: target,
        kind: "tag",
        value: "old-clip-range",
        range: { start: time(0n), duration: time(2n) },
        origin: "user",
        reviewState: "needs_review",
      },
    ];
    for (const a of annotations) s = media.upsertAnnotation(s, a);
    const before = structuredClone(s);
    const plan = media.buildOrganizationPlan(
      s,
      [selected],
      { ...media.defaultRuleSet(id(50)), orderedFields: [] },
      [],
      () => id(60),
    );
    expect(plan.assignments[0].tags).toEqual(
      kind === "asset" ? ["whole-asset"] : ["whole-asset", "whole-clip"],
    );
    expect(s).toEqual(before);
  },
);
