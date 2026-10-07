import { compareMediaTime, MediaTimeSchema, TimeRangeSchema, TranscriptSchema, type MediaTime, type TimeRange, type Transcript, type TranscriptSegment } from "@pea/core";
import { z } from "zod";
import { createRevision } from "./revisions.js";
import { toSrt, toVtt } from "./subtitles.js";
import type { TranscriptRevision, TranscriptSourceKind } from "./types.js";

export interface SubtitleOrigin {
  kind: "source" | "sequence";
  mediaAssetId: string;
  label: string;
  inputRevision: string;
  /** Explicit sequence placement of the input's zero point; applied only on export. */
  timelineStart?: MediaTime;
}

export interface SubtitleDocument {
  schemaVersion: "1.0";
  id: string;
  origin: SubtitleOrigin;
  revisions: TranscriptRevision[];
  currentRevisionId: string;
  rawSourceJSON?: string;
}

const identity = z.string().refine(value => value.trim().length > 0, "identity must be nonempty");
const sourceKind = z.enum(["premiere", "srt", "vtt", "whisper-cpp"]);
const originSchema = z.object({
  kind: z.enum(["source", "sequence"]), mediaAssetId: identity, label: identity,
  inputRevision: identity, timelineStart: MediaTimeSchema.optional()
});
const documentSchema = z.object({
  schemaVersion: z.literal("1.0"), id: identity, origin: originSchema,
  revisions: z.array(z.object({
    id: identity, transcriptId: identity, parentRevisionId: identity.optional(),
    source: sourceKind, createdAt: identity, transcript: TranscriptSchema
  })).min(1),
  currentRevisionId: identity, rawSourceJSON: z.string().optional()
});

function validateTime(time: MediaTime, positive = false): void {
  MediaTimeSchema.parse(time);
  if (!Number.isSafeInteger(time.timebase.numerator) || !Number.isSafeInteger(time.timebase.denominator)) {
    throw new Error("timebase must use safe positive integers");
  }
  if (time.ticks < 0n || (positive && time.ticks === 0n)) {
    throw new Error(positive ? "subtitle duration must be positive" : "subtitle time must be nonnegative");
  }
}

function validateText(text: string): void {
  if (!text.trim() || text.split(/\r\n?|\n/).some(line => !line.trim()) || text.includes("-->")) {
    throw new Error("subtitle text must be nonempty and cannot contain blank cue blocks or timing delimiters");
  }
}

/** Validate all history, including the master, and return a detached canonical document. */
function validateDocument(input: unknown): SubtitleDocument {
  const doc = documentSchema.parse(input);
  if (doc.origin.kind === "sequence" && !doc.origin.timelineStart) {
    throw new Error("sequence documents require an explicit timelineStart");
  }
  if (doc.origin.timelineStart) validateTime(doc.origin.timelineStart);
  const revisionIds = new Set<string>();
  const transcriptId = doc.revisions[0].transcriptId;
  for (const [index, revision] of doc.revisions.entries()) {
    if (revisionIds.has(revision.id)) throw new Error("duplicate revision ID");
    revisionIds.add(revision.id);
    if (revision.parentRevisionId !== (index ? doc.revisions[index - 1].id : undefined)) {
      throw new Error("revision history must be a linear parent chain with an unparented master");
    }
    identity.parse(revision.transcript.id);
    if (revision.transcriptId !== transcriptId || revision.transcript.id !== transcriptId) {
      throw new Error("all revisions must refer to the same transcript");
    }
    const segmentIds = new Set<string>();
    for (const segment of revision.transcript.segments) {
      identity.parse(segment.id);
      if (segmentIds.has(segment.id)) throw new Error("duplicate segment ID");
      segmentIds.add(segment.id);
      if (segment.mediaAssetId !== doc.origin.mediaAssetId) throw new Error("segment media asset differs from document origin");
      if (segment.speakerId !== undefined) identity.parse(segment.speakerId);
      validateTime(segment.range.start);
      validateTime(segment.range.duration, true);
      validateText(segment.text);
    }
  }
  if (doc.currentRevisionId !== doc.revisions[doc.revisions.length - 1].id) {
    throw new Error("current revision must be the last revision in the document");
  }
  return doc;
}

export function createSubtitleDocument(input: {
  id: string; origin: SubtitleOrigin; transcript: Transcript; source: TranscriptSourceKind;
  createdAt?: string; rawSourceJSON?: string;
}): SubtitleDocument {
  const master = createRevision({
    id: `${input.id}:revision:1`, transcript: input.transcript, source: input.source, createdAt: input.createdAt
  });
  return validateDocument({
    schemaVersion: "1.0", id: input.id, origin: input.origin,
    revisions: [master], currentRevisionId: master.id, rawSourceJSON: input.rawSourceJSON
  });
}

export function currentTranscript(doc: SubtitleDocument): Transcript {
  const validated = validateDocument(doc);
  return validated.revisions[validated.revisions.length - 1].transcript;
}

function edit(doc: SubtitleDocument, change: (transcript: Transcript) => void): SubtitleDocument {
  const next = validateDocument(doc);
  const parent = next.revisions[next.revisions.length - 1];
  const transcript = TranscriptSchema.parse(parent.transcript);
  change(transcript);
  let counter = next.revisions.length + 1;
  while (next.revisions.some(revision => revision.id === `${next.id}:revision:${counter}`)) counter++;
  const revision = createRevision({
    id: `${next.id}:revision:${counter}`, transcript, source: parent.source, parentRevisionId: parent.id
  });
  next.revisions.push(revision);
  next.currentRevisionId = revision.id;
  return validateDocument(next);
}

function segmentIndex(transcript: Transcript, id: string): number {
  identity.parse(id);
  const index = transcript.segments.findIndex(segment => segment.id === id);
  if (index < 0) throw new Error(`unknown subtitle segment: ${id}`);
  return index;
}

export function updateSubtitleCue(doc: SubtitleDocument, input: {
  segmentId: string; text?: string; range?: TimeRange; speakerId?: string | null;
}): SubtitleDocument {
  return edit(doc, transcript => {
    const segment = transcript.segments[segmentIndex(transcript, input.segmentId)];
    if (input.text !== undefined) segment.text = input.text;
    if (input.range !== undefined) segment.range = TimeRangeSchema.parse(input.range);
    if (input.speakerId === null) delete segment.speakerId;
    else if (input.speakerId !== undefined) segment.speakerId = input.speakerId;
  });
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Exact arithmetic; only the existing subtitle exporter quantizes to milliseconds. */
function combineTime(a: MediaTime, b: MediaTime, sign: 1 | -1 = 1): MediaTime {
  validateTime(a); validateTime(b);
  const aDenominator = BigInt(a.timebase.denominator), bDenominator = BigInt(b.timebase.denominator);
  const numerator = a.ticks * BigInt(a.timebase.numerator) * bDenominator
    + BigInt(sign) * b.ticks * BigInt(b.timebase.numerator) * aDenominator;
  const denominator = aDenominator * bDenominator;
  const factor = gcd(numerator, denominator);
  const reducedDenominator = denominator / factor;
  if (reducedDenominator > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("combined timebase exceeds safe integer precision");
  return { ticks: numerator / factor, timebase: { numerator: 1, denominator: Number(reducedDenominator) } };
}

export function splitSubtitleCue(doc: SubtitleDocument, input: {
  segmentId: string; splitAt: MediaTime; leftText: string; rightText: string;
}): SubtitleDocument {
  return edit(doc, transcript => {
    const index = segmentIndex(transcript, input.segmentId);
    const segment = transcript.segments[index];
    validateTime(input.splitAt);
    const end = combineTime(segment.range.start, segment.range.duration);
    if (compareMediaTime(input.splitAt, segment.range.start) <= 0 || compareMediaTime(input.splitAt, end) >= 0) {
      throw new Error("split time must be strictly inside the subtitle cue");
    }
    let counter = 1;
    while (transcript.segments.some(cue => cue.id === `${segment.id}:split:${counter}`)) counter++;
    transcript.segments.splice(index, 1,
      { ...segment, text: input.leftText, range: { start: segment.range.start, duration: combineTime(input.splitAt, segment.range.start, -1) } },
      { ...segment, id: `${segment.id}:split:${counter}`, text: input.rightText, range: { start: MediaTimeSchema.parse(input.splitAt), duration: combineTime(end, input.splitAt, -1) } }
    );
  });
}

export function mergeSubtitleCues(doc: SubtitleDocument, input: {
  firstSegmentId: string; secondSegmentId: string;
}): SubtitleDocument {
  return edit(doc, transcript => {
    const firstIndex = segmentIndex(transcript, input.firstSegmentId);
    const secondIndex = segmentIndex(transcript, input.secondSegmentId);
    if (secondIndex !== firstIndex + 1) throw new Error("merged cues must be adjacent and in their current order");
    const first = transcript.segments[firstIndex], second = transcript.segments[secondIndex];
    if (first.mediaAssetId !== second.mediaAssetId || first.speakerId !== second.speakerId) {
      throw new Error("merged cues must share a media asset and speaker");
    }
    if (compareMediaTime(combineTime(first.range.start, first.range.duration), second.range.start) > 0) {
      throw new Error("cannot merge reversed or overlapping subtitle cues");
    }
    const end = combineTime(second.range.start, second.range.duration);
    transcript.segments.splice(firstIndex, 2, {
      ...first, text: `${first.text}\n${second.text}`,
      range: { start: first.range.start, duration: combineTime(end, first.range.start, -1) }
    });
  });
}

export function searchSubtitleDocument(doc: SubtitleDocument, query: string): TranscriptSegment[] {
  const transcript = currentTranscript(doc);
  if (typeof query !== "string") throw new Error("search query must be a string");
  const normalized = query.normalize("NFC").trim().toLocaleLowerCase();
  if (!normalized) return [];
  return transcript.segments.filter(segment => segment.text.normalize("NFC").toLocaleLowerCase().includes(normalized));
}

export function serializeSubtitleDocument(doc: SubtitleDocument): string {
  return JSON.stringify(validateDocument(doc), (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value, 2);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid subtitle document object");
  return value as Record<string, unknown>;
}

function readTime(value: unknown): MediaTime {
  const time = object(value);
  if (typeof time.ticks !== "string" || !/^(?:0|[1-9]\d*)$/.test(time.ticks)) {
    throw new Error("persisted ticks must be an exact nonnegative decimal string");
  }
  return MediaTimeSchema.parse({ ...time, ticks: BigInt(time.ticks) });
}

export function parseSubtitleDocument(json: string): SubtitleDocument {
  if (typeof json !== "string") throw new Error("subtitle document JSON must be a string");
  const doc = object(JSON.parse(json));
  if (doc.schemaVersion !== "1.0") throw new Error("unsupported subtitle document schema version");
  const source = object(doc.origin);
  if (source.timelineStart !== undefined) source.timelineStart = readTime(source.timelineStart);
  if (!Array.isArray(doc.revisions)) throw new Error("subtitle revisions must be an array");
  for (const value of doc.revisions) {
    const transcript = object(object(value).transcript);
    if (!Array.isArray(transcript.segments)) throw new Error("subtitle segments must be an array");
    for (const value of transcript.segments) {
      const range = object(object(value).range);
      range.start = readTime(range.start);
      range.duration = readTime(range.duration);
    }
  }
  return validateDocument(doc);
}

export function exportSubtitleDocument(doc: SubtitleDocument, format: "srt" | "vtt"): string {
  const validated = validateDocument(doc);
  const transcript = validated.revisions[validated.revisions.length - 1].transcript;
  if (validated.origin.kind === "sequence") {
    const timelineStart = validated.origin.timelineStart!;
    for (const segment of transcript.segments) segment.range.start = combineTime(segment.range.start, timelineStart);
  }
  if (format === "srt") return toSrt(transcript);
  if (format === "vtt") return toVtt(transcript);
  throw new Error("unsupported subtitle export format");
}
