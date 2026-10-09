import { describe, expect, it } from "vitest";
import { AudioDecisionSchema } from "@pea/core";
import { analyzeDialogue, buildDuckingEnvelope, detectBeats, measureSampleLevels, parseAudioDecision, proposeNormalization, runAudioJob, sampleTime, serializeAudioDecision } from "@pea/audio";

describe("public consumer workflow", () => {
  it("combines source analysis, a sequence duck decision and explicit loudness capability", async () => {
    const samples = new Float32Array(2000);
    for (const position of [0, 500, 1000, 1500]) samples[position] = 0.5;
    const pcm = { mediaAssetId: "voice", fingerprint: { algorithm: "sha256" as const, value: "test" }, sampleRate: 1000, startSample: 0n, channels: [samples] };
    expect(measureSampleLevels(pcm).samplePeakDbfs).toBeCloseTo(-6.0206, 4);
    expect(detectBeats(pcm).bpm).toBe(120);
    const range = { start: sampleTime(500n, 1000), duration: sampleTime(500n, 1000) };
    expect(analyzeDialogue(pcm, { id: "transcript", segments: [{ id: "s", mediaAssetId: "voice", text: "voice", range }] }).segments).toHaveLength(1);
    const duck = buildDuckingEnvelope({ id: "duck", clipId: "bgm-clip", mediaAssetId: "bgm", sampleRate: 1000, range: { start: 0n, end: 2000n }, dialogue: [{ start: 500n, end: 1000n }], amountDb: -10, attackSamples: 100n, holdSamples: 0n, releaseSamples: 100n });
    expect(AudioDecisionSchema.parse(parseAudioDecision(serializeAudioDecision(duck)).decision).kind).toBe("duck");
    expect(duck.clipId).toBe("bgm-clip");
    const measured = await runAudioJob({ jobId: "j", artifactId: "a", artifactVersion: 1, attempt: 0, operation: "loudness", settings: {}, source: { media: { id: "voice", fingerprint: pcm.fingerprint, uri: "file:///voice.wav", readOnly: true }, range, sampleRate: 1000, channelCount: 1 } }, { id: "fixture-meter", version: "1", measureLoudness: async () => ({ integratedLufs: -20, truePeakDbtp: -8 }) }, { isCurrent: () => true });
    expect(measured.job.status).toBe("completed");
    expect(proposeNormalization({ integratedLufs: -20, truePeakDbtp: -8 }, { integratedLufs: -16, maxTruePeakDbtp: -1, maxGainDb: 6 })).toMatchObject({ gainDb: 4, targetReached: true });
  });
});
