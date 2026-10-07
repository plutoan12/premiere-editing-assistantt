import { HostBindingSchema } from "./bindings.js";
import { z } from "zod";
import {
  MediaAssetSchema,
  ClipReferenceSchema,
  MediaTimeSchema,
  ArtifactSchema,
  MediaDocumentSchema,
  validateBoundedTimeRange,
} from "@pea/core";
import {
  ScanRecordSchema,
  IngestResultSchema,
  ProbeRecordSchema,
} from "./scan.js";
import {
  MetadataRecordSchema,
  AnnotationSchema,
  targetKey,
} from "./metadata.js";
import { RuleSetSchema } from "./rules.js";
import { SavedSearchSchema } from "./search-query.js";
import { OrganizationPlanSchema } from "./plans.js";
import { HostApplyPlanSchema, ApplyReceiptSchema } from "./editor-contract.js";
export type IdFactory = () => string;
export const AssetRecordSchema = z
  .object({
    asset: MediaAssetSchema.extend({
      fingerprint: MediaAssetSchema.shape.fingerprint.extend({
        value: z.string().regex(/^[a-fA-F0-9]{64}$/),
      }),
    }),
    fileRevision: z.number().int().positive(),
    locations: z.array(z.string().min(1)).min(1),
    duration: MediaTimeSchema.optional(),
    availability: z.enum(["online", "offline", "unknown"]),
    probe: ProbeRecordSchema.optional(),
    analysis: z
      .object({
        artifact: ArtifactSchema,
        providerVersion: z.string().min(1),
        settingsKey: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AssetRecord = z.infer<typeof AssetRecordSchema>;
export { HostBindingSchema, type HostBinding } from "./bindings.js";
export const CatalogSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    catalogId: z.uuid(),
    revision: z.number().int().nonnegative(),
    assets: z.array(AssetRecordSchema),
    clips: z.array(ClipReferenceSchema),
    bindings: z.array(HostBindingSchema),
    organizationPlans: z.array(OrganizationPlanSchema),
    hostPlans: z.array(HostApplyPlanSchema),
    receipts: z.array(ApplyReceiptSchema),
    savedSearches: z.array(SavedSearchSchema),
    annotations: z.array(AnnotationSchema),
    ruleSets: z.array(RuleSetSchema),
    scans: z.array(ScanRecordSchema),
    jobs: z.array(IngestResultSchema),
    metadata: z.array(MetadataRecordSchema),
    clipStates: z.array(
      z
        .object({
          clipId: z.string().min(1),
          fileRevision: z.number().int().positive(),
          reviewState: z.enum(["confirmed", "needs_review"]),
        })
        .strict(),
    ),
  })
  .strict();
export type CatalogState = z.infer<typeof CatalogSchema>;
export interface CatalogStore {
  read(): Promise<CatalogState>;
  commit(expectedRevision: number, next: CatalogState): Promise<CatalogState>;
}
export function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`duplicate ${label}`);
}
export function validateCatalog(input: CatalogState): CatalogState {
  const state = CatalogSchema.parse(input);
  MediaDocumentSchema.parse({
    schemaVersion: "1.0.0",
    kind: "media",
    data: { assets: state.assets.map((x) => x.asset), clips: state.clips },
  });
  unique(
    state.bindings.map((x) => x.bindingId),
    "binding ID",
  );
  unique(
    state.bindings.map((x) =>
      JSON.stringify([x.adapterId, x.hostProjectKey, x.hostItemId]),
    ),
    "host identity",
  );
  for (const record of state.assets) {
    if (!record.locations.includes(record.asset.uri))
      throw new Error("canonical URI must be a location");
    unique(record.locations, "asset location");
    if (record.duration && record.duration.ticks <= 0n)
      throw new Error("media duration must be positive");
  }
  for (const clip of state.clips) {
    const record = state.assets.find((x) => x.asset.id === clip.mediaAssetId)!;
    const cs = state.clipStates.find((x) => x.clipId === clip.id);
    if (
      cs &&
      cs.fileRevision !== record.fileRevision &&
      cs.reviewState !== "needs_review"
    )
      throw new Error("stale clip must require review");
    if (record.duration && (!cs || cs.fileRevision === record.fileRevision))
      validateBoundedTimeRange(clip.sourceRange, record.duration);
  }
  for (const binding of state.bindings)
    if (!state.clips.some((x) => x.id === binding.clipId))
      throw new Error("binding references missing clip");
  unique(
    state.scans.map((x) => x.scanId),
    "scan ID",
  );
  unique(
    state.jobs.map((x) => x.job.id),
    "job ID",
  );
  unique(
    state.clipStates.map((x) => x.clipId),
    "clip state",
  );
  unique(
    state.metadata.map((x) => `${targetKey(x.target)}:${x.field}`),
    "metadata field",
  );
  for (const cs of state.clipStates)
    if (!state.clips.some((x) => x.id === cs.clipId))
      throw new Error("clip state references missing clip");
  for (const row of state.metadata) {
    if (!hasTarget(state, row.target))
      throw new Error("metadata references missing target");
    if (row.candidates.some((x) => x.field !== row.field))
      throw new Error("metadata candidate field mismatch");
  }
  for (const scan of state.scans) {
    if (scan.result?.scanId && scan.result.scanId !== scan.scanId)
      throw new Error("scan result identity mismatch");
    if (
      scan.result?.assetId &&
      !state.assets.some((x) => x.asset.id === scan.result?.assetId)
    )
      throw new Error("scan references missing asset");
    if (
      scan.result?.clipId &&
      !state.clips.some((x) => x.id === scan.result?.clipId)
    )
      throw new Error("scan references missing clip");
  }
  unique(
    state.savedSearches.map((x) => x.id),
    "saved search ID",
  );
  unique(
    state.annotations.map((x) => x.id),
    "annotation ID",
  );
  unique(
    state.ruleSets.map((x) => x.id),
    "rule set ID",
  );
  for (const a of state.annotations) {
    if (!hasTarget(state, a.target))
      throw new Error("annotation references missing target");
    const assetId =
      a.target.kind === "asset"
        ? a.target.id
        : state.clips.find((x) => x.id === a.target.id)!.mediaAssetId;
    const asset = state.assets.find((x) => x.asset.id === assetId)!;
    if (a.range) {
      if (a.range.start.ticks < 0n || a.range.duration.ticks <= 0n)
        throw new Error("invalid annotation range");
      if (a.reviewState === "confirmed") {
        if (!asset.duration)
          throw new Error("annotation range requires source duration");
        validateBoundedTimeRange(a.range, asset.duration);
      }
    }
  }
  unique(
    state.organizationPlans.map((x) => x.id),
    "organization plan ID",
  );
  unique(
    state.hostPlans.map((x) => x.id),
    "host plan ID",
  );
  unique(
    state.receipts.map((x) => x.id),
    "receipt ID",
  );
  for (const p of state.organizationPlans) {
    if (!state.ruleSets.some((r) => r.id === p.ruleSetId))
      throw new Error("organization plan references missing rule set");
    unique(
      p.assignments.map((x) => targetKey(x.target)),
      "plan target",
    );
    if (
      [...p.assignments, ...p.issues].some((x) => !hasTarget(state, x.target))
    )
      throw new Error("plan references missing target");
  }
  for (const p of state.hostPlans) {
    const organization = state.organizationPlans.find(
      (x) => x.id === p.organizationPlanId,
    );
    if (!organization)
      throw new Error("host plan references missing organization plan");
    if (
      p.operations.some(
        (op) =>
          !organization.assignments.some(
            (a) => targetKey(a.target) === targetKey(op.target),
          ),
      )
    )
      throw new Error("host operation outside reviewed scope");
  }
  for (const r of state.receipts) {
    const p = state.hostPlans.find((x) => x.id === r.hostPlanId);
    if (
      !p ||
      r.operations.some((op) => !p.operations.some((x) => x.id === op.id))
    )
      throw new Error("receipt references missing plan or operation");
    if (
      r.status === "verified_applied" &&
      r.operations.length !== p.operations.length
    )
      throw new Error("incomplete verified receipt");
    if (
      r.createdBindings.some((b) => !state.clips.some((c) => c.id === b.clipId))
    )
      throw new Error("receipt binding references missing clip");
  }
  return state;
}
export function emptyCatalog(catalogId: string): CatalogState {
  return validateCatalog({
    schemaVersion: "1.0.0",
    catalogId,
    revision: 0,
    assets: [],
    clips: [],
    bindings: [],
    scans: [],
    jobs: [],
    metadata: [],
    clipStates: [],
    annotations: [],
    ruleSets: [],
    savedSearches: [],
    organizationPlans: [],
    hostPlans: [],
    receipts: [],
  });
}

export function hasTarget(
  state: CatalogState,
  target: { kind: "asset" | "clip"; id: string },
): boolean {
  return target.kind === "asset"
    ? state.assets.some((x) => x.asset.id === target.id)
    : state.clips.some((x) => x.id === target.id);
}
