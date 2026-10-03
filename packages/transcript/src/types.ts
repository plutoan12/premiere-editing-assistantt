import type { Transcript } from "@pea/core";

export type TranscriptSourceKind = "premiere" | "srt" | "vtt" | "whisper-cpp";

export interface TranscriptRevision {
  id: string;
  transcriptId: string;
  parentRevisionId?: string;
  source: TranscriptSourceKind;
  createdAt: string;
  transcript: Transcript;
}

export interface TranscriptProvider {
  readonly kind: TranscriptSourceKind;
  transcribe(input: { mediaAssetId: string; mediaPath: string; signal?: AbortSignal }): Promise<Transcript>;
}
