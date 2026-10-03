import type { MediaTime, Transcript, TranscriptSegment } from "@pea/core";

const mt = (ticks: bigint): MediaTime => ({ ticks, timebase: { numerator: 1, denominator: 1000 } });
const normalize = (input: string) => input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const blocks = (input: string) => input.replace(/^\n+|\n+$/g, "").split(/\n[ \t]*\n+/).filter(Boolean);

function identity(value: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error("transcript and media asset identities must be nonempty");
}

function parseTimestamp(value: string, vtt: boolean): bigint {
  const match = (vtt ? /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/ : /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/).exec(value);
  if (!match) throw new Error(`invalid subtitle timestamp: ${value}`);
  return ((BigInt(match[1] ?? 0) * 60n + BigInt(match[2])) * 60n + BigInt(match[3])) * 1000n + BigInt(match[4]);
}

function cue(block: string, i: number, mediaAssetId: string, vtt: boolean): TranscriptSegment {
  const lines = block.split("\n");
  const index = lines[0].includes("-->") ? 0 : 1;
  const timing = lines[index]?.match(vtt ? /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+[^\n]*)?$/ : /^(\S+)[ \t]+-->[ \t]+(\S+)[ \t]*$/);
  if (!timing || lines.length <= index + 1) throw new Error(`invalid subtitle cue ${i + 1}`);
  const start = parseTimestamp(timing[1], vtt), end = parseTimestamp(timing[2], vtt);
  if (end <= start) throw new Error("subtitle duration must be positive");
  return { id: `${vtt ? "vtt" : "srt"}-${i + 1}`, mediaAssetId, range: { start: mt(start), duration: mt(end - start) }, text: lines.slice(index + 1).join("\n") };
}

export function parseSrt(input: string, mediaAssetId: string, transcriptId = "imported-srt"): Transcript {
  identity(mediaAssetId); identity(transcriptId);
  return { id: transcriptId, segments: blocks(normalize(input)).map((block, i) => cue(block, i, mediaAssetId, false)) };
}

/** Timing/text interchange only: NOTE, STYLE, REGION, cue identifiers and settings are not retained. */
export function parseVtt(input: string, mediaAssetId: string, transcriptId = "imported-vtt"): Transcript {
  identity(mediaAssetId); identity(transcriptId);
  const parts = blocks(normalize(input));
  const header = parts.shift() ?? "";
  if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n[^\n]*)*$/.test(header) || header.includes("-->")) throw new Error("missing or invalid WEBVTT header");
  if (/X-TIMESTAMP-MAP/i.test(header)) throw new Error("WebVTT timestamp-map requires an explicit timeline mapping");
  const cues = parts.filter(block => !/^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block));
  const segments = cues.map((block, i) => cue(block, i, mediaAssetId, true));
  if (segments.some((s, i) => i > 0 && s.range.start.ticks < segments[i - 1].range.start.ticks)) throw new Error("WebVTT cues must be ordered by start time");
  return { id: transcriptId, segments };
}

function fraction(time: MediaTime): [bigint, bigint] {
  const { numerator, denominator } = time.timebase;
  if (typeof time.ticks !== "bigint" || time.ticks < 0n || !Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error("invalid nonnegative media time or timebase");
  return [time.ticks * BigInt(numerator), BigInt(denominator)];
}

function endpoints(s: TranscriptSegment): [bigint, bigint] {
  const [a, b] = fraction(s.range.start), [c, d] = fraction(s.range.duration);
  // Floor each absolute endpoint once. Never floor duration separately or coerce ticks to Number.
  const start = a * 1000n / b, end = (a * d + c * b) * 1000n / (b * d);
  if (end <= start) throw new Error("subtitle duration is below millisecond precision");
  return [start, end];
}

function formatTime(ms: bigint, comma: boolean): string {
  const h = ms / 3600000n, m = ms / 60000n % 60n, s = ms / 1000n % 60n, frac = ms % 1000n;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}${comma ? "," : "."}${String(frac).padStart(3,"0")}`;
}

function exportCues(transcript: Transcript, vtt: boolean): string {
  const assets = new Set(transcript.segments.map(s => s.mediaAssetId));
  if (assets.size > 1) throw new Error("export one media asset or explicitly project onto one timeline first");
  for (const asset of assets) identity(asset);
  let previousStart = -1n;
  return transcript.segments.map((s, i) => {
    const [start, end] = endpoints(s);
    if (vtt && start < previousStart) throw new Error("WebVTT cues must be ordered by start time");
    previousStart = start;
    return `${vtt ? "" : `${i + 1}\n`}${formatTime(start, !vtt)} --> ${formatTime(end, !vtt)}\n${s.text}`;
  }).join("\n\n") + (transcript.segments.length ? "\n" : "");
}

export const toSrt = (transcript: Transcript): string => exportCues(transcript, false);
export const toVtt = (transcript: Transcript): string => `WEBVTT\n\n${exportCues(transcript, true)}`;
