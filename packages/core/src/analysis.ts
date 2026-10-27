import { z } from "zod";
import { ConfidenceSchema, IsoDateTimeSchema, TimeRangeSchema } from "./common.js";
import { EntityIdSchema } from "./ids.js";

export { ConfidenceSchema };
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const HexDigestSchema = z.string().regex(/^[0-9a-f]{32,128}$/, "must be a lowercase hex digest");

/**
 * Who produced a result and from what. Carried by every AI or analysis output
 * and by every artifact. Deliberately vendor-neutral: no request ids, raw
 * responses or SDK objects.
 */
export const ProvenanceSchema = z.strictObject({
  producer: z.strictObject({
    module: z.string().min(1),
    version: z.string().min(1),
  }),
  provider: z
    .strictObject({
      name: z.string().min(1),
      model: z.string().min(1).optional(),
      version: z.string().min(1).optional(),
    })
    .optional(),
  prompt: z
    .strictObject({
      id: z.string().min(1),
      version: z.string().min(1),
    })
    .optional(),
  createdAt: IsoDateTimeSchema,
  inputFingerprints: z.array(HexDigestSchema).optional(),
  configHash: HexDigestSchema.optional(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/** A semantic or deterministic label on an asset, optionally bound to a time range. */
export const AnalysisTagSchema = z.strictObject({
  id: EntityIdSchema,
  mediaAssetId: EntityIdSchema,
  /** Open vocabulary owned by the producing engine, e.g. "scene", "person", "speech", "ng", "beat". */
  kind: z.string().min(1),
  value: z.string(),
  range: TimeRangeSchema.optional(),
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
});

export type AnalysisTag = z.infer<typeof AnalysisTagSchema>;
