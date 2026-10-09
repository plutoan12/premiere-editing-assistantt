import {
  type EditorAdapter,
  type HostContext,
  type HostApplyPlan,
  type ApplyReceipt,
  type OrganizationPlan,
  type ObservedState,
  preflight,
  reconcileReceipt,
} from "../index.js";
import { id } from "./fixtures.js";
/** Test host with observable applied state. This is not a supported editor. */
export function testEditor(
  initial: HostContext,
  hierarchy = true,
): EditorAdapter<{ path: string[] }> {
  const context = structuredClone(initial),
    observed: Record<string, ObservedState> = {},
    plans = new Map<string, HostApplyPlan<{ path: string[] }>>();
  return {
    async getCapabilities() {
      return structuredClone(context.capabilities);
    },
    async readContext() {
      return structuredClone(context);
    },
    async planApply(plan: OrganizationPlan, live: HostContext) {
      return {
        id: id(700),
        organizationPlanId: plan.id,
        adapterSchemaVersion: "test-1",
        expectedContext: structuredClone(live),
        operations: plan.assignments.map((a, i) => ({
          id: id(710 + i),
          target: a.target,
          dependsOn: [],
          requiredCapabilities: ["hierarchy" as const],
          action: { path: a.pathSegments },
        })),
        compatibilityReport: hierarchy
          ? []
          : [
              {
                severity: "blocking" as const,
                code: "hierarchy_loss",
                targets: plan.assignments.map((a) => a.target),
              },
            ],
      };
    },
    async apply(plan) {
      if (plan.adapterSchemaVersion !== "test-1")
        throw new Error("unsupported adapter schema");
      const current = {
        ...context,
        catalogRevision: plan.expectedContext.catalogRevision,
      };
      if (!preflight(plan, current).ok) throw new Error("preflight failed");
      for (const op of plan.operations) observed[op.id] = "at_target";
      plans.set(plan.id, plan);
      return {
        id: id(750),
        hostPlanId: plan.id,
        status: "partial",
        operations: plan.operations.map((x) => ({
          id: x.id,
          state: "pending",
        })),
        createdBindings: [],
      };
    },
    async verify(receipt: ApplyReceipt) {
      const plan = plans.get(receipt.hostPlanId);
      if (!plan) throw new Error("no applied plan");
      return reconcileReceipt(plan, receipt, observed);
    },
    async reveal() {
      return { status: "unsupported", reason: "test host has no UI" };
    },
  };
}
