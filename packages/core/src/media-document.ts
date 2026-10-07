import { z } from 'zod';
import { MediaAssetSchema, ClipReferenceSchema } from './media.js';
import { CORE_SCHEMA_VERSION } from './version.js';
import { encodeMediaTime, decodeMediaTime } from './time-json.js';
export const MediaDocumentSchema = z.object({
  schemaVersion: z.literal(CORE_SCHEMA_VERSION), kind: z.literal('media'),
  data: z.object({ assets: z.array(MediaAssetSchema), clips: z.array(ClipReferenceSchema) }).strict(),
}).strict().superRefine((doc, ctx) => {
  const assets = new Set<string>(), clips = new Set<string>();
  for (const asset of doc.data.assets) {
    if (assets.has(asset.id)) ctx.addIssue({code:'custom',message:'duplicate asset ID'});
    assets.add(asset.id);
  }
  for (const clip of doc.data.clips) {
    if (clips.has(clip.id) || !assets.has(clip.mediaAssetId)) ctx.addIssue({code:'custom',message:'duplicate clip or missing asset reference'});
    if (clip.sourceRange.start.ticks < 0n || clip.sourceRange.duration.ticks <= 0n) ctx.addIssue({code:'custom',message:'invalid source range'});
    clips.add(clip.id);
  }
});
export type MediaDocument = z.infer<typeof MediaDocumentSchema>;
const WireClipSchema = ClipReferenceSchema.extend({
  sourceRange: z.object({start:z.unknown().transform(decodeMediaTime),duration:z.unknown().transform(decodeMediaTime)}).strict(),
});
const WireDocumentSchema = z.object({
  schemaVersion:z.literal(CORE_SCHEMA_VERSION),kind:z.literal('media'),
  data:z.object({assets:z.array(MediaAssetSchema),clips:z.array(WireClipSchema)}).strict(),
}).strict();
export function decodeMediaDocument(input: unknown): MediaDocument {
  return MediaDocumentSchema.parse(WireDocumentSchema.parse(input));
}
export function encodeMediaDocument(input: MediaDocument) {
  const doc = MediaDocumentSchema.parse(input);
  return {...doc,data:{assets:doc.data.assets,clips:doc.data.clips.map(clip => ({...clip,sourceRange:{
    start:encodeMediaTime(clip.sourceRange.start),duration:encodeMediaTime(clip.sourceRange.duration),
  }}))}};
}
