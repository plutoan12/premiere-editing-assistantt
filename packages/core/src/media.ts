import { z } from "zod";
import {
  ContractViolation,
  IsoDateTimeSchema,
  NleRefsSchema,
  NonNegativeIntegerSchema,
  NonNegativeMediaTimeSchema,
  PositiveIntegerSchema,
  PositiveRationalSchema,
  SchemaVersionSchema,
  TimeRangeSchema,
} from "./common.js";
import { EntityIdSchema } from "./ids.js";
import { compareMediaTime } from "./time.js";

export const MediaFingerprintSchema = z.strictObject({
  algorithm: z.enum(["sha256", "blake3", "xxh3"]),
  /** Lowercase hex digest. */
  value: z.string().regex(/^[0-9a-f]{32,128}$/, "digest must be lowercase hex"),
  sizeBytes: NonNegativeIntegerSchema,
  /** `full` hashes every byte; `sampled` hashes size + sampled chunks for speed. */
  strategy: z.enum(["full", "sampled"]),
});

export type MediaFingerprint = z.infer<typeof MediaFingerprintSchema>;

export const VideoStreamSchema = z.strictObject({
  frameRate: PositiveRationalSchema,
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
});

export const AudioStreamSchema = z.strictObject({
  sampleRate: PositiveIntegerSchema,
  channels: PositiveIntegerSchema,
});

export const MediaAssetSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: EntityIdSchema,
    projectId: EntityIdSchema,
    sourcePath: z.string().min(1),
    /** Source media is never modified or deleted by the platform. */
    source: z.strictObject({
      immutable: z.literal(true),
      fingerprint: MediaFingerprintSchema,
      modifiedAt: IsoDateTimeSchema.optional(),
    }),
    duration: NonNegativeMediaTimeSchema,
    video: VideoStreamSchema.optional(),
    audio: AudioStreamSchema.optional(),
    nleRefs: NleRefsSchema.optional(),
  })
  .refine((a) => a.video !== undefined || a.audio !== undefined, "asset needs at least one video or audio stream");

export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const ClipReferenceSchema = z.strictObject({
  id: EntityIdSchema,
  mediaAssetId: EntityIdSchema,
  sourceRange: TimeRangeSchema,
});

export type ClipReference = z.infer<typeof ClipReferenceSchema>;

/** Schema-validate a clip and check its range against the asset it references. */
export function validateClipReference(clip: ClipReference, asset: MediaAsset): ClipReference {
  const parsed = ClipReferenceSchema.parse(clip);
  if (parsed.mediaAssetId !== asset.id) {
    throw new ContractViolation(`clip ${parsed.id} references asset ${parsed.mediaAssetId} but was validated against asset ${asset.id}`);
  }
  if (parsed.sourceRange.start.ticks < 0) {
    throw new ContractViolation(`clip ${parsed.id} starts at a negative source time`);
  }
  if (compareMediaTime(parsed.sourceRange.end, asset.duration) > 0) {
    throw new ContractViolation(`clip ${parsed.id} ends beyond the asset duration`);
  }
  return parsed;
}
