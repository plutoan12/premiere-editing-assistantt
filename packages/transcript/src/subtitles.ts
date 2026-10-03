import type { MediaTime, Transcript, TranscriptSegment } from "@pea/core";

const TIMEBASE = { numerator: 1, denominator: 1000 } as const;
const mt = (milliseconds: number): MediaTime => ({ ticks: BigInt(milliseconds), timebase: TIMEBASE });

function parseTimestamp(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 3) throw new Error(`invalid subtitle timestamp: ${value}`);
  const [h, m, s] = parts;
  const seconds = Number(s);
  if (![Number(h), Number(m), seconds].every(Number.isFinite)) throw new Error(`invalid subtitle timestamp: ${value}`);
  return Math.round((Number(h) * 3600 + Number(m) * 60 + seconds) * 1000);
}

function segment(id: string, mediaAssetId: string, startMs: number, endMs: number, text: string): TranscriptSegment {
  if (endMs < startMs) throw new Error("subtitle end precedes start");
  return { id, mediaAssetId, range: { start: mt(startMs), duration: mt(endMs - startMs) }, text: text.trim() };
}

export function parseSrt(input: string, mediaAssetId: string, transcriptId = "imported-srt"): Transcript {
  const blocks = input.replace(/\r/g, "").trim().split(/\n{2,}/).filter(Boolean);
  return { id: transcriptId, segments: blocks.map((block, i) => {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex(line => line.includes("-->"));
    if (timingIndex < 0) throw new Error(`missing SRT timing in block ${i + 1}`);
    const [start, end] = lines[timingIndex].split("-->").map(v => v.trim());
    return segment(`srt-${i + 1}`, mediaAssetId, parseTimestamp(start), parseTimestamp(end), lines.slice(timingIndex + 1).join("\n"));
  }) };
}

export function parseVtt(input: string, mediaAssetId: string, transcriptId = "imported-vtt"): Transcript {
  const clean = input.replace(/\r/g, "").replace(/^\uFEFF?WEBVTT[^\n]*\n+/, "");
  const blocks = clean.trim().split(/\n{2,}/).filter(Boolean);
  return { id: transcriptId, segments: blocks.map((block, i) => {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex(line => line.includes("-->"));
    if (timingIndex < 0) throw new Error(`missing VTT timing in block ${i + 1}`);
    const [start, endWithSettings] = lines[timingIndex].split("-->").map(v => v.trim());
    const end = endWithSettings.split(/\s+/)[0];
    return segment(`vtt-${i + 1}`, mediaAssetId, parseTimestamp(start), parseTimestamp(end), lines.slice(timingIndex + 1).join("\n"));
  }) };
}

function formatTime(ms: bigint, comma: boolean): string {
  const n = Number(ms);
  const h = Math.floor(n / 3600000), m = Math.floor((n % 3600000) / 60000), s = Math.floor((n % 60000) / 1000), frac = n % 1000;
  const sep = comma ? "," : ".";
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}${sep}${String(frac).padStart(3,"0")}`;
}

function toMilliseconds(time: MediaTime): bigint {
  return time.ticks * BigInt(time.timebase.numerator) * 1000n / BigInt(time.timebase.denominator);
}

export function toSrt(transcript: Transcript): string {
  return transcript.segments.map((s, i) => {
    const start = toMilliseconds(s.range.start);
    const end = start + toMilliseconds(s.range.duration);
    return `${i + 1}\n${formatTime(start, true)} --> ${formatTime(end, true)}\n${s.text}`;
  }).join("\n\n") + (transcript.segments.length ? "\n" : "");
}

export function toVtt(transcript: Transcript): string {
  const body = transcript.segments.map(s => {
    const start = toMilliseconds(s.range.start);
    const end = start + toMilliseconds(s.range.duration);
    return `${formatTime(start, false)} --> ${formatTime(end, false)}\n${s.text}`;
  }).join("\n\n");
  return `WEBVTT\n\n${body}${body ? "\n" : ""}`;
}
