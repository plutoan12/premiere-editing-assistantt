import type { Speaker, Transcript, TimeRange } from "@pea/core";
import { observeTranscriptTask, throwIfTranscriptAborted, TranscriptUnavailableError } from "@pea/transcript";
import type { TranscriptProvider } from "@pea/transcript";

export interface PremiereWord {
  text: string;
  range: TimeRange;
  confidence: number;
  type: "word" | "punctuation";
  eos: boolean;
  tags: string[];
}
export interface PremiereTranscriptSnapshot {
  transcript: Transcript;
  speakers: Speaker[];
  language: string;
  wordTimings: Record<string, PremiereWord[]>;
  /** Unchanged source JSON: never synthesize word timing from edited segment text. */
  rawJSON: string;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid Adobe transcript object");
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("invalid Adobe transcript array");
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("invalid Adobe transcript string");
  return value;
};
const micros = (value: unknown): bigint => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 1000000))) throw new Error("invalid Adobe transcript seconds");
  return BigInt(Math.round(value * 1000000));
};
function range(value: Record<string, unknown>): TimeRange {
  const start = micros(value.start); micros(value.duration);
  const end = micros((value.start as number) + (value.duration as number));
  return { start: { ticks: start, timebase: { numerator: 1, denominator: 1000000 } }, duration: { ticks: end - start, timebase: { numerator: 1, denominator: 1000000 } } };
}

/** Adobe provides floating-point seconds; canonical display timing is rounded to microseconds. */
export function parsePremiereTranscript(rawJSON: string, mediaAssetId: string): PremiereTranscriptSnapshot {
  text(mediaAssetId);
  if (typeof rawJSON !== "string" || rawJSON.length > 16 * 1024 * 1024) throw new Error("invalid Adobe transcript JSON size");
  const root = object(JSON.parse(rawJSON)), language = text(root.language);
  const speakers = array(root.speakers).map(value => { const s = object(value); return { id: text(s.id), label: text(s.name) }; });
  const ids = new Set(speakers.map(s => s.id));
  if (ids.size !== speakers.length) throw new Error("duplicate Adobe speaker identity");
  const wordTimings: Record<string, PremiereWord[]> = Object.create(null);
  const transcript: Transcript = { id: `premiere:${mediaAssetId}`, segments: array(root.segments).map((value, i) => {
    const s = object(value), segmentRange = range(s), speakerId = text(s.speaker), segmentLanguage = text(s.language);
    if (!ids.has(speakerId)) throw new Error("unresolved Adobe speaker reference");
    const id = `premiere:${mediaAssetId}:segment:${i + 1}`;
    const words = array(s.words).map(value => {
      const w = object(value), wordRange = range(w);
      if (wordRange.start.ticks < segmentRange.start.ticks || wordRange.start.ticks + wordRange.duration.ticks > segmentRange.start.ticks + segmentRange.duration.ticks) throw new Error("word range is outside its segment");
      if (typeof w.confidence !== "number" || !Number.isFinite(w.confidence) || w.confidence < 0 || w.confidence > 1 || typeof w.eos !== "boolean" || (w.type !== "word" && w.type !== "punctuation") || typeof w.text !== "string") throw new Error("invalid Adobe word metadata");
      return { text: w.text, range: wordRange, confidence: w.confidence, eos: w.eos, type: w.type, tags: array(w.tags).map(text) } as PremiereWord;
    });
    if (!words.length) throw new Error("Adobe segment contains no words");
    wordTimings[id] = words;
    const noSpaces = /^(?:ja-|zh-|cmn-)/i.test(segmentLanguage);
    const displayText = words.reduce((out, w) => out + (!out || noSpaces || w.type === "punctuation" || /^\s/.test(w.text) || /\s$/.test(out) ? "" : " ") + w.text, "");
    return { id, mediaAssetId, range: segmentRange, text: displayText, speakerId };
  }) };
  return { transcript, speakers, language, wordTimings, rawJSON };
}

export interface PremiereClip { isSequence(): Promise<boolean>; }
export interface PremiereTranscriptAPI<C extends PremiereClip> {
  exportToJSON?(clip: C): Promise<string>;
  hasTranscript?(clip: C): boolean | Promise<boolean>;
  transcribeClipProjectItem?(clip: C): Promise<boolean>;
}

/** Inject the real ppro.Transcript and resolve a pinned ClipProjectItem by Core asset ID in the panel. */
export function createPremiereTranscriptAdapter<C extends PremiereClip>(options: {
  api: PremiereTranscriptAPI<C>;
  resolveClip: (mediaAssetId: string) => Promise<C | null>;
  allowTranscription?: boolean;
  hostTimeoutMs?: number;
}): TranscriptProvider & { readSnapshot(input: Parameters<TranscriptProvider["transcribe"]>[0]): Promise<PremiereTranscriptSnapshot> } {
  const { api } = options;
  async function readSnapshot(input: Parameters<TranscriptProvider["transcribe"]>[0]): Promise<PremiereTranscriptSnapshot> {
    text(input.mediaAssetId);
    const wait = <T>(work: () => Promise<T>) => observeTranscriptTask(work, input.signal, options.hostTimeoutMs);
    const clip = await wait(() => options.resolveClip(input.mediaAssetId));
    if (!clip) throw new Error("no matching Premiere clip for media asset");
    if (await wait(() => clip.isSequence())) throw new Error("sequence transcripts require explicit timeline projection");
    if (typeof api.exportToJSON !== "function") throw new TranscriptUnavailableError("host transcript export is unavailable");
    let existing: boolean | undefined;
    if (typeof api.hasTranscript === "function") {
      existing = await wait(async () => api.hasTranscript!(clip));
      if (typeof existing !== "boolean") throw new Error("invalid host transcript availability result");
    }
    let json = existing === false ? "" : await wait(() => api.exportToJSON!(clip));
    if (typeof json !== "string") throw new Error("invalid host transcript export result");
    if (!json.trim()) {
      if (existing === true) throw new Error("host reported a transcript but exported no data");
      if (!options.allowTranscription || typeof api.transcribeClipProjectItem !== "function") throw new TranscriptUnavailableError("no existing Premiere transcript");
      const success = await wait(() => api.transcribeClipProjectItem!(clip));
      if (success !== true) throw new Error("Premiere transcription did not succeed");
      json = await wait(() => api.exportToJSON!(clip));
      if (typeof json !== "string" || !json.trim()) throw new Error("Premiere transcription returned no transcript");
    }
    throwIfTranscriptAborted(input.signal);
    return parsePremiereTranscript(json, input.mediaAssetId);
  }
  return { kind: "premiere", readSnapshot, transcribe: async input => (await readSnapshot(input)).transcript };
}
