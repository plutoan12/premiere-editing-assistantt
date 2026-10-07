import { expect, it } from "vitest";
import * as media from "./index.js";
import { id } from "./testing/fixtures.js";
const target = { kind: "clip" as const, id: id(2) };
function context(): media.HostContext {
  return {
    adapterId: "test-hierarchy",
    hostProjectKey: "p1",
    hostRevision: "r1",
    catalogRevision: 0,
    capabilities: {
      editor: "test editor",
      appVersion: "1",
      os: "test",
      adapterVersion: "1",
      revision: "c1",
      features: Object.fromEntries(
        [
          "hierarchy",
          "tags",
          "import",
          "projectFields",
          "reveal",
          "rangeReveal",
          "undo",
        ].map((x) => [x, { status: "supported", reason: "test" }]),
      ) as media.CapabilityReport["features"],
    },
    bindings: [
      {
        bindingId: id(3),
        clipId: id(2),
        adapterId: "test-hierarchy",
        hostProjectKey: "p1",
        hostItemId: "item1",
        hostRevision: "i1",
      },
    ],
    items: [
      { hostItemId: "item1", kind: "clip", itemRevision: "i1", metadata: [] },
    ],
  };
}
function plan(): media.HostApplyPlan {
  return {
    id: id(4),
    organizationPlanId: id(5),
    adapterSchemaVersion: "1",
    expectedContext: context(),
    compatibilityReport: [],
    operations: [
      {
        id: id(6),
        target,
        expectedItemRevision: "i1",
        dependsOn: [],
        requiredCapabilities: ["hierarchy"],
        action: { kind: "move" },
      },
    ],
  };
}
function receipt(): media.ApplyReceipt {
  return {
    id: id(7),
    hostPlanId: id(4),
    status: "partial",
    operations: [{ id: id(6), state: "pending" }],
    createdBindings: [],
  };
}
it("blocks project, catalog, application or capability changes", () => {
  expect(media.preflight(plan(), context()).ok).toBe(true);
  for (const field of [
    "hostProjectKey",
    "hostRevision",
    "adapterId",
  ] as const) {
    const c = context();
    c[field] = "other";
    expect(media.preflight(plan(), c).ok).toBe(false);
  }
  const c = context();
  c.catalogRevision++;
  expect(media.preflight(plan(), c).ok).toBe(false);
  const app = context();
  app.capabilities.appVersion = "2";
  expect(media.preflight(plan(), app).ok).toBe(false);
  const cap = context();
  cap.capabilities.features.hierarchy.status = "unverified";
  expect(media.preflight(plan(), cap).ok).toBe(false);
});
it("blocks item changes and bindings from another project", () => {
  const c = context();
  c.items[0].itemRevision = "changed";
  expect(media.preflight(plan(), c).ok).toBe(false);
  c.items[0].itemRevision = "i1";
  c.bindings[0].hostProjectKey = "other";
  expect(media.preflight(plan(), c).ok).toBe(false);
});
it("does not treat exports or unknown observations as verified", () => {
  const r = receipt();
  r.status = "exported";
  r.operations[0].state = "exported";
  expect(media.reconcileReceipt(plan(), r, { [id(6)]: "unknown" }).status).toBe(
    "exported",
  );
  expect(
    media.reconcileReceipt(plan(), r, { [id(6)]: "at_target" }).status,
  ).toBe("verified_applied");
  expect(() =>
    media.ApplyReceiptSchema.parse({ ...r, status: "verified_applied" }),
  ).toThrow();
});
it("retries only observed unapplied work and waits for dependencies", () => {
  const p = plan(),
    r = receipt();
  expect(media.retryableOperationIds(p, r, { [id(6)]: "at_expected" })).toEqual(
    [id(6)],
  );
  for (const observation of ["at_target", "unknown", "changed"] as const)
    expect(media.retryableOperationIds(p, r, { [id(6)]: observation })).toEqual(
      [],
    );
  p.operations.push({
    id: id(8),
    target,
    dependsOn: [id(6)],
    requiredCapabilities: ["hierarchy"],
    action: { kind: "move" },
  });
  r.operations.push({ id: id(8), state: "pending" });
  expect(
    media.retryableOperationIds(p, r, {
      [id(6)]: "at_expected",
      [id(8)]: "at_expected",
    }),
  ).toEqual([id(6)]);
  expect(
    media.retryableOperationIds(p, undefined, {
      [id(6)]: "at_target",
      [id(8)]: "at_expected",
    }),
  ).toEqual([id(8)]);
});
it("rejects dependency cycles and receipts for another plan", () => {
  const p = plan();
  p.operations[0].dependsOn = [id(6)];
  expect(() => media.preflight(p, context())).toThrow(/depend/);
  const r = receipt();
  r.hostPlanId = id(99);
  expect(() => media.reconcileReceipt(plan(), r, {})).toThrow(/plan/);
});
it("reports hierarchy loss for a tags-only adapter without losing catalog data", () => {
  const p = plan(),
    c = context();
  c.capabilities.features.hierarchy.status = "unsupported";
  p.expectedContext = c;
  p.compatibilityReport = [
    { severity: "blocking", code: "hierarchy_loss", targets: [target] },
  ];
  expect(media.preflight(p, c)).toMatchObject({ ok: false });
  expect(p.operations[0].target).toEqual(target);
});
