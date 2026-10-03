import { describe, expect, it } from "vitest";
import { createWhisperCppProvider } from "./index.js";

const ffmpegPath = process.env.PEA_TEST_FFMPEG;
const whisperPath = process.env.PEA_TEST_WHISPER;
const modelPath = process.env.PEA_TEST_MODEL;
const mediaPath = process.env.PEA_TEST_MEDIA;
const enabled = Boolean(ffmpegPath && whisperPath && modelPath && mediaPath);

function words(value: string): string[] {
  return value.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
}
function editDistance(a: string[], b: string[]): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return row[b.length];
}

describe("actual whisper.cpp acceptance", () => {
  it.skipIf(!enabled)("runs a real local model against permitted media", async () => {
    const provider = createWhisperCppProvider({
      ffmpegPath: ffmpegPath!, whisperPath: whisperPath!, modelPath: modelPath!,
      language: process.env.PEA_TEST_LANGUAGE ?? "auto", timeoutMs: 30 * 60 * 1000
    });
    const started = performance.now();
    const transcript = await provider.transcribe({ mediaAssetId: "acceptance-media", mediaPath: mediaPath! });
    const elapsedMs = Math.round(performance.now() - started);
    expect(transcript.segments.length).toBeGreaterThan(0);
    let previousEnd = 0n;
    for (const segment of transcript.segments) {
      expect(segment.text.trim().length).toBeGreaterThan(0);
      expect(segment.range.start.ticks).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = segment.range.start.ticks + segment.range.duration.ticks;
    }
    const recognized = transcript.segments.map(s => s.text).join(" ").trim();
    const reference = process.env.PEA_TEST_REFERENCE_TEXT?.trim();
    const report: Record<string, unknown> = { elapsedMs, segments: transcript.segments.length, recognizedCharacters: recognized.length };
    if (reference) {
      const expected = words(reference), actual = words(recognized);
      report.wordErrorRate = expected.length ? editDistance(expected, actual) / expected.length : null;
      report.referenceWords = expected.length; report.recognizedWords = actual.length;
    }
    console.log("PEA_REAL_MODEL_REPORT", JSON.stringify(report));
  }, 30 * 60 * 1000);
});
