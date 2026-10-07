import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

function quality(reference: string, recognized: string) {
  const expected = words(reference), actual = words(recognized);
  const expectedCharacters = [...expected.join("")], actualCharacters = [...actual.join("")];
  return {
    wordErrorRate: expected.length ? editDistance(expected, actual) / expected.length : null,
    characterErrorRate: expectedCharacters.length ? editDistance(expectedCharacters, actualCharacters) / expectedCharacters.length : null,
    referenceWords: expected.length, recognizedWords: actual.length,
    referenceCharacters: expectedCharacters.length, recognizedCharacters: actualCharacters.length
  };
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

describe("acceptance quality metrics", () => {
  it("measures a Korean syllable substitution separately from whitespace-token WER", () => {
    expect(quality("가나", "가다")).toMatchObject({ wordErrorRate: 1, characterErrorRate: 0.5, referenceCharacters: 2 });
  });
  it("normalizes Korean composition and excludes whitespace from CER", () => {
    expect(quality("한 글!".normalize("NFD"), "한글")).toMatchObject({ wordErrorRate: 1, characterErrorRate: 0 });
  });
  it("measures omissions rather than just matching nonempty text", () => {
    expect(quality("Hello brave world", "hello world")).toMatchObject({ wordErrorRate: 1 / 3, characterErrorRate: 1 / 3 });
  });
  it("does not assign an accuracy score without reference characters", () => {
    expect(quality("!!!", "recognized")).toMatchObject({ wordErrorRate: null, characterErrorRate: null });
  });
});

describe("actual whisper.cpp acceptance", () => {
  it.skipIf(!enabled)("runs a real local model against permitted media", async () => {
    const provider = createWhisperCppProvider({
      ffmpegPath: ffmpegPath!, whisperPath: whisperPath!, modelPath: modelPath!,
      language: process.env.PEA_TEST_LANGUAGE ?? "auto", timeoutMs: 30 * 60 * 1000
    });
    const startedAt = new Date().toISOString(), started = performance.now();
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
    const report: Record<string, unknown> = {
      startedAt, elapsedMs, language: process.env.PEA_TEST_LANGUAGE ?? "auto",
      platform: process.platform, architecture: process.arch,
      segments: transcript.segments.length, recognizedCharacters: recognized.length,
      timingScope: "FFmpeg decode and whisper.cpp inference; excludes model/binary hashing",
      normalization: "NFKC, lowercase letters/numbers; WER uses whitespace tokens, CER omits whitespace",
      paths: { ffmpeg: ffmpegPath, whisper: whisperPath, model: modelPath, media: mediaPath }
    };
    if (reference) {
      Object.assign(report, quality(reference, recognized));
    }
    if (process.env.PEA_TEST_FFPROBE) {
      const { stdout } = await promisify(execFile)(process.env.PEA_TEST_FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "json", mediaPath!]);
      const duration = Number(JSON.parse(stdout).format?.duration);
      expect(Number.isFinite(duration) && duration > 0).toBe(true);
      report.mediaDurationSeconds = duration;
      report.realTimeFactor = elapsedMs / (duration * 1000);
    }
    if (process.env.PEA_TEST_INCLUDE_TEXT === "1") {
      report.referenceText = reference;
      report.recognizedText = recognized;
    }
    if (process.env.PEA_TEST_TRANSCRIPT_PATH) {
      const json = JSON.stringify(transcript, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value, 2);
      await writeFile(process.env.PEA_TEST_TRANSCRIPT_PATH, json + "\n", { flag: "wx" });
      report.transcriptPath = process.env.PEA_TEST_TRANSCRIPT_PATH;
    }
    if (process.env.PEA_TEST_REPORT_PATH) {
      const [ffmpeg, whisper, model, media] = await Promise.all([ffmpegPath!, whisperPath!, modelPath!, mediaPath!].map(sha256));
      report.sha256 = { ffmpeg, whisper, model, media };
      await writeFile(process.env.PEA_TEST_REPORT_PATH, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    }
    console.log("PEA_REAL_MODEL_REPORT", JSON.stringify(report));
  }, 30 * 60 * 1000);
});
