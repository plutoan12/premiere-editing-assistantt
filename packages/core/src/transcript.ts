import { z } from "zod";
import { ProvenanceSchema } from "./analysis.js";
import { ConfidenceSchema, ContractViolation, SchemaVersionSchema, TimeRangeSchema } from "./common.js";
import { EntityIdSchema } from "./ids.js";
import type { MediaAsset } from "./media.js";
import { compareMediaTime } from "./time.js";

/** BCP 47-shaped language tag such as "ko", "ko-KR", "en-US". */
export const LanguageTagSchema = z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, "must be a BCP 47 language tag");

export const SpeakerSchema = z.strictObject({
  id: EntityIdSchema,
  label: z.string().min(1),
  confidence: ConfidenceSchema.optional(),
});

export type Speaker = z.infer<typeof SpeakerSchema>;

export const TranscriptWordSchema = z.strictObject({
  text: z.string(),
  range: TimeRangeSchema,
  confidence: ConfidenceSchema.optional(),
});

export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const TranscriptSegmentSchema = z
  .strictObject({
    id: EntityIdSchema,
    range: TimeRangeSchema,
    text: z.string(),
    speakerId: EntityIdSchema.optional(),
    confidence: ConfidenceSchema.optional(),
    words: z.array(TranscriptWordSchema).optional(),
  })
  .refine(
    (s) =>
      s.words === undefined ||
      s.words.every((w) => compareMediaTime(w.range.start, s.range.start) >= 0 && compareMediaTime(w.range.end, s.range.end) <= 0),
    "word timings must lie inside the segment range",
  );

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

function segmentsOrderedAndDisjoint(segments: readonly TranscriptSegment[]): boolean {
  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1]!;
    const next = segments[i]!;
    if (compareMediaTime(next.range.start, prev.range.end) < 0) return false;
  }
  return true;
}

export const TranscriptSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: EntityIdSchema,
    mediaAssetId: EntityIdSchema,
    language: LanguageTagSchema,
    speakers: z.array(SpeakerSchema),
    segments: z.array(TranscriptSegmentSchema),
    provenance: ProvenanceSchema,
  })
  .refine((t) => new Set(t.speakers.map((s) => s.id)).size === t.speakers.length, "speaker ids must be unique")
  .refine((t) => new Set(t.segments.map((s) => s.id)).size === t.segments.length, "segment ids must be unique")
  .refine((t) => segmentsOrderedAndDisjoint(t.segments), "segments must be ordered by start and must not overlap")
  .refine((t) => {
    const known = new Set(t.speakers.map((s) => s.id));
    return t.segments.every((s) => s.speakerId === undefined || known.has(s.speakerId));
  }, "segments may only reference declared speakers");

export type Transcript = z.infer<typeof TranscriptSchema>;

/** Schema-validate a transcript and check that every segment lies inside its asset. */
export function validateTranscript(transcript: Transcript, asset: MediaAsset): Transcript {
  const parsed = TranscriptSchema.parse(transcript);
  if (parsed.mediaAssetId !== asset.id) {
    throw new ContractViolation(`transcript ${parsed.id} references asset ${parsed.mediaAssetId} but was validated against asset ${asset.id}`);
  }
  for (const segment of parsed.segments) {
    if (segment.range.start.ticks < 0) {
      throw new ContractViolation(`segment ${segment.id} starts at a negative time`);
    }
    if (compareMediaTime(segment.range.end, asset.duration) > 0) {
      throw new ContractViolation(`segment ${segment.id} ends beyond the asset duration`);
    }
  }
  return parsed;
}
