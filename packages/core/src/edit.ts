/**
 * Editorial decision contracts. Independent of any NLE track API: decisions
 * reference source media and describe placement; nothing here can mutate a
 * source file.
 */
import { z } from "zod";
import { ProvenanceSchema } from "./analysis.js";
import {
  ContractViolation,
  NonNegativeIntegerSchema,
  NonNegativeMediaTimeSchema,
  PositiveIntegerSchema,
  PositiveRationalSchema,
  SchemaVersionSchema,
  TimeRangeSchema,
} from "./common.js";
import { EntityIdSchema } from "./ids.js";
import { ClipReferenceSchema, validateClipReference, type MediaAsset } from "./media.js";
import { LanguageTagSchema } from "./transcript.js";

export const TrackKindSchema = z.enum(["video", "audio"]);
export type TrackKind = z.infer<typeof TrackKindSchema>;

export const DestinationSchema = z.strictObject({
  trackKind: TrackKindSchema,
  trackIndex: NonNegativeIntegerSchema,
  position: NonNegativeMediaTimeSchema,
});

export const EditDecisionSchema = z.strictObject({
  id: EntityIdSchema,
  kind: z.enum(["insert", "overwrite"]),
  clip: ClipReferenceSchema,
  destination: DestinationSchema,
  enabled: z.boolean(),
  label: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});

export type EditDecision = z.infer<typeof EditDecisionSchema>;

export const SequencePlanSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: EntityIdSchema,
    projectId: EntityIdSchema,
    name: z.string().min(1),
    frameRate: PositiveRationalSchema,
    /** Tick rate of the sequence timeline. */
    timebase: PositiveRationalSchema,
    /** The only policy: plans reference sources and never copy, trim or rewrite them. */
    sourcePolicy: z.literal("reference-only"),
    decisions: z.array(EditDecisionSchema),
    provenance: ProvenanceSchema.optional(),
  })
  .refine((p) => new Set(p.decisions.map((d) => d.id)).size === p.decisions.length, "decision ids must be unique");

export type SequencePlan = z.infer<typeof SequencePlanSchema>;

/** Schema-validate a plan and check every clip against the assets it references. */
export function validateSequencePlan(plan: SequencePlan, assets: readonly MediaAsset[]): SequencePlan {
  const parsed = SequencePlanSchema.parse(plan);
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  for (const decision of parsed.decisions) {
    const asset = byId.get(decision.clip.mediaAssetId);
    if (asset === undefined) {
      throw new ContractViolation(`decision ${decision.id} references missing media asset ${decision.clip.mediaAssetId}`);
    }
    if (asset.projectId !== parsed.projectId) {
      throw new ContractViolation(`media asset ${asset.id} belongs to project ${asset.projectId}, not ${parsed.projectId}`);
    }
    validateClipReference(decision.clip, asset);
  }
  return parsed;
}

const ScalarParameterSchema = z.union([z.string(), z.number(), z.boolean()]);

export const GraphicDecisionSchema = z.strictObject({
  id: EntityIdSchema,
  template: z.strictObject({
    kind: z.enum(["mogrt", "title", "caption-style"]),
    /** Template identifier as the adapter resolves it (MOGRT name/id, title preset). */
    ref: z.string().min(1),
    version: z.string().min(1).optional(),
  }),
  range: TimeRangeSchema,
  trackIndex: NonNegativeIntegerSchema,
  parameters: z.record(z.string().min(1), ScalarParameterSchema),
  provenance: ProvenanceSchema.optional(),
});

export type GraphicDecision = z.infer<typeof GraphicDecisionSchema>;

export const AudioTargetSchema = z.union([
  z.strictObject({ trackKind: z.literal("audio"), trackIndex: NonNegativeIntegerSchema }),
  z.strictObject({ clipId: EntityIdSchema }),
]);

export const AudioDecisionSchema = z.strictObject({
  id: EntityIdSchema,
  kind: z.enum(["gain", "duck", "mute", "fade-in", "fade-out", "loudness-normalize"]),
  target: AudioTargetSchema,
  range: TimeRangeSchema,
  parameters: z.record(z.string().min(1), z.number()),
  provenance: ProvenanceSchema.optional(),
});

export type AudioDecision = z.infer<typeof AudioDecisionSchema>;

export const DeliveryVariantSchema = z.strictObject({
  id: EntityIdSchema,
  name: z.string().min(1),
  frame: z.strictObject({ width: PositiveIntegerSchema, height: PositiveIntegerSchema }),
  frameRate: PositiveRationalSchema.optional(),
  reframe: z.enum(["none", "center", "auto-subject"]),
  locale: LanguageTagSchema.optional(),
  exportPreset: z.string().min(1).optional(),
});

export type DeliveryVariant = z.infer<typeof DeliveryVariantSchema>;
