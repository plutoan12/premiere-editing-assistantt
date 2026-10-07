import { z } from "zod";
import { ProvenanceSchema } from "@pea/core";
export const CatalogTargetSchema = z
  .object({ kind: z.enum(["asset", "clip"]), id: z.string().min(1) })
  .strict();
export type CatalogTarget = z.infer<typeof CatalogTargetSchema>;
export const MetadataFieldSchema = z.enum([
  "captureDate",
  "deviceId",
  "scene",
  "take",
  "mediaKind",
]);
export type MetadataField = z.infer<typeof MetadataFieldSchema>;
export const MetadataCandidateSchema = z
  .object({
    field: MetadataFieldSchema,
    value: z.string(),
    source: z.enum(["probe", "host", "folderRule", "filenameRule"]),
    provenance: ProvenanceSchema,
    rawValue: z.string().optional(),
    timezone: z.string().optional(),
  })
  .strict();
export type MetadataCandidate = z.infer<typeof MetadataCandidateSchema>;
export const MetadataRecordSchema = z
  .object({
    target: CatalogTargetSchema,
    field: MetadataFieldSchema,
    candidates: z.array(MetadataCandidateSchema),
    override: z
      .object({ value: z.string(), locked: z.literal(true) })
      .strict()
      .optional(),
  })
  .strict();
export type MetadataRecord = z.infer<typeof MetadataRecordSchema>;
export const targetKey = (target: CatalogTarget) =>
  `${target.kind}:${target.id}`;

import { TimeRangeSchema } from "@pea/core";
import { hasTarget, validateCatalog, type CatalogState } from "./catalog.js";
export const AnnotationSchema = z
  .object({
    id: z.uuid(),
    target: CatalogTargetSchema,
    kind: z.enum(["tag", "note", "favorite"]),
    value: z.union([z.string(), z.boolean()]),
    range: TimeRangeSchema.optional(),
    origin: z.literal("user"),
    reviewState: z.enum(["confirmed", "needs_review"]),
  })
  .strict()
  .refine(
    (a) =>
      a.kind === "favorite"
        ? typeof a.value === "boolean"
        : typeof a.value === "string",
    "annotation value type does not match kind",
  );
export type Annotation = z.infer<typeof AnnotationSchema>;
export type ResolvedMetadata = {
  value?: string;
  status: "rule_match" | "user_confirmed" | "missing" | "conflict";
  reasons: string[];
};
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  );
}
const usable = (field: MetadataField, value: string) =>
  value.trim().length > 0 &&
  (field !== "captureDate" || validDate(value)) &&
  (field !== "mediaKind" ||
    ["video", "audio", "image", "other"].includes(value));
export function resolveMetadata(input: MetadataRecord): ResolvedMetadata {
  const row = MetadataRecordSchema.parse(input);
  if (row.override)
    return usable(row.field, row.override.value)
      ? {
          value: row.override.value,
          status: "user_confirmed",
          reasons: ["user override"],
        }
      : { status: "missing", reasons: ["user value is empty or invalid"] };
  const candidates = row.candidates.filter((x) => usable(row.field, x.value));
  const values = [...new Set(candidates.map((x) => x.value))];
  const reasons = candidates.map(
    (x) => `${x.source}: ${x.value} (${x.provenance.provider})`,
  );
  if (values.length > 1) return { status: "conflict", reasons };
  if (!values.length)
    return { status: "missing", reasons: ["no usable observation"] };
  return { value: values[0], status: "rule_match", reasons };
}
export function assetForTarget(target: CatalogTarget, state: CatalogState) {
  if (!hasTarget(state, target)) throw new Error("missing target");
  const assetId =
    target.kind === "asset"
      ? target.id
      : state.clips.find((x) => x.id === target.id)!.mediaAssetId;
  return state.assets.find((x) => x.asset.id === assetId)!;
}
export function effectiveRecord(
  target: CatalogTarget,
  state: CatalogState,
  field: MetadataField,
): MetadataRecord {
  const asset = assetForTarget(target, state);
  const base = state.metadata.find(
    (x) =>
      x.target.kind === "asset" &&
      x.target.id === asset.asset.id &&
      x.field === field,
  );
  const local =
    target.kind === "clip"
      ? state.metadata.find(
          (x) =>
            x.target.kind === "clip" &&
            x.target.id === target.id &&
            x.field === field,
        )
      : undefined;
  return {
    target,
    field,
    candidates: [...(base?.candidates ?? []), ...(local?.candidates ?? [])],
    override: local?.override ?? base?.override,
  };
}
export function effectiveMetadata(
  target: CatalogTarget,
  state: CatalogState,
  field: MetadataField,
): ResolvedMetadata {
  return resolveMetadata(effectiveRecord(target, state, field));
}
export function setMetadataOverride(
  input: CatalogState,
  target: CatalogTarget,
  field: MetadataField,
  value: string | null,
): CatalogState {
  const state = validateCatalog(input);
  assetForTarget(target, state);
  let row = state.metadata.find(
    (x) => targetKey(x.target) === targetKey(target) && x.field === field,
  );
  if (!row) {
    row = { target, field, candidates: [] };
    state.metadata.push(row);
  }
  if (value === null) delete row.override;
  else row.override = { value, locked: true };
  return validateCatalog(state);
}
export function upsertAnnotation(
  input: CatalogState,
  annotation: Annotation,
): CatalogState {
  const state = validateCatalog(input),
    row = AnnotationSchema.parse(annotation);
  const index = state.annotations.findIndex((x) => x.id === row.id);
  if (index < 0) state.annotations.push(row);
  else state.annotations[index] = row;
  return validateCatalog(state);
}
export function removeAnnotation(
  input: CatalogState,
  id: string,
): CatalogState {
  const state = validateCatalog(input);
  state.annotations = state.annotations.filter((x) => x.id !== id);
  return state;
}
export function annotationsForTarget(
  target: CatalogTarget,
  state: CatalogState,
): Annotation[] {
  const asset = assetForTarget(target, state);
  return state.annotations.filter(
    (a) =>
      (a.target.kind === "asset" && a.target.id === asset.asset.id) ||
      targetKey(a.target) === targetKey(target),
  );
}
