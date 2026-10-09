import { z } from "zod";
import {
  type CatalogState,
  type CatalogStore,
  type IdFactory,
  validateCatalog,
} from "./catalog.js";
import {
  CatalogTargetSchema,
  type CatalogTarget,
  targetKey,
  assetForTarget,
  annotationsForTarget,
} from "./metadata.js";
import { classify, type RuleSet } from "./rules.js";
import { HostApplyPlanSchema, type HostApplyPlan } from "./editor-contract.js";
export const OrganizationPlanSchema = z
  .object({
    id: z.uuid(),
    catalogRevision: z.number().int().nonnegative(),
    ruleSetId: z.uuid(),
    ruleSetVersion: z.number().int().positive(),
    assignments: z.array(
      z
        .object({
          target: CatalogTargetSchema,
          pathSegments: z.array(z.string().min(1)).min(1),
          tags: z.array(z.string()),
        })
        .strict(),
    ),
    issues: z.array(
      z
        .object({
          target: CatalogTargetSchema,
          code: z.string().min(1),
          reasons: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();
export type OrganizationPlan = z.infer<typeof OrganizationPlanSchema>;
export function buildOrganizationPlan(
  input: CatalogState,
  targets: CatalogTarget[],
  rules: RuleSet,
  acceptedUnknowns: CatalogTarget[],
  ids: IdFactory,
): OrganizationPlan {
  const state = validateCatalog(input),
    plan: OrganizationPlan = {
      id: ids(),
      catalogRevision: state.revision,
      ruleSetId: rules.id,
      ruleSetVersion: rules.version,
      assignments: [],
      issues: [],
    };
  const accepted = new Set(acceptedUnknowns.map(targetKey)),
    seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(targetKey(target))) continue;
    seen.add(targetKey(target));
    const asset = assetForTarget(target, state),
      result = classify(target, state, rules);
    const clipState =
      target.kind === "clip" &&
      state.clipStates.find((x) => x.clipId === target.id);
    const code =
      asset.availability !== "online"
        ? asset.availability === "offline"
          ? "offline"
          : "availability_unknown"
        : asset.sourceState === "unverified"
          ? "source_unverified"
          : clipState &&
              (clipState.fileRevision !== asset.fileRevision ||
                clipState.reviewState === "needs_review")
            ? "source_changed"
            : result.status === "conflict"
              ? "conflict"
              : result.status === "needs_review"
                ? "metadata_unconfirmed"
                : result.requiresReview && !accepted.has(targetKey(target))
                  ? "missing"
                  : undefined;
    if (code) plan.issues.push({ target, code, reasons: result.reasons });
    else
      plan.assignments.push({
        target,
        pathSegments: result.pathSegments,
        tags: [
          ...new Set(
            annotationsForTarget(target, state)
              .filter(
                (x) =>
                  x.kind === "tag" && x.reviewState === "confirmed" && !x.range,
              )
              .map((x) => String(x.value)),
          ),
        ],
      });
  }
  return OrganizationPlanSchema.parse(plan);
}
export async function saveReviewedPlan(
  store: CatalogStore,
  organizationInput: OrganizationPlan,
  hostInput: HostApplyPlan,
): Promise<CatalogState> {
  const organization = OrganizationPlanSchema.parse(organizationInput),
    host = HostApplyPlanSchema.parse(hostInput),
    state = await store.read();
  if (
    organization.catalogRevision !== state.revision ||
    host.expectedContext.catalogRevision !== state.revision
  )
    throw new Error("reviewed catalog revision changed");
  if (host.organizationPlanId !== organization.id)
    throw new Error("organization plan mismatch");
  host.expectedContext.catalogRevision = state.revision + 1;
  state.organizationPlans.push(organization);
  state.hostPlans.push(host);
  return store.commit(state.revision, state);
}
