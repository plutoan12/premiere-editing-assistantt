import { z } from "zod"; import { FrameRateSchema, TimeRangeSchema } from "./time.js";
export const MediaFingerprintSchema=z.object({algorithm:z.literal("sha256"),value:z.string().min(1)});
export const MediaAssetSchema=z.object({id:z.string().min(1),uri:z.string().min(1),fingerprint:MediaFingerprintSchema,frameRate:FrameRateSchema.optional(),readOnly:z.literal(true)});
export const ClipReferenceSchema=z.object({id:z.string().min(1),mediaAssetId:z.string().min(1),sourceRange:TimeRangeSchema});
export type MediaFingerprint=z.infer<typeof MediaFingerprintSchema>; export type MediaAsset=z.infer<typeof MediaAssetSchema>; export type ClipReference=z.infer<typeof ClipReferenceSchema>;
