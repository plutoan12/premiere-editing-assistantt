import { TranscriptSchema, type Transcript } from "@pea/core";
import type { TranscriptRevision, TranscriptSourceKind } from "./types.js";

export function createRevision(input: {
  id: string;
  transcript: Transcript;
  source: TranscriptSourceKind;
  createdAt?: string;
  parentRevisionId?: string;
}): TranscriptRevision {
  return {
    id: input.id,
    transcriptId: input.transcript.id,
    parentRevisionId: input.parentRevisionId,
    source: input.source,
    createdAt: input.createdAt ?? new Date().toISOString(),
    // Schema parsing yields detached nested data, including bigint, without a browser-only global.
    transcript: TranscriptSchema.parse(input.transcript)
  };
}
