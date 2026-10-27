import { describe, expect, expectTypeOf, it } from "vitest";
import { newEntityId } from "./ids.js";
import { FPS_23_976, mediaTime, rational } from "./time.js";
import { TranscriptSegmentSchema } from "./transcript.js";
import { AnalysisTagSchema } from "./analysis.js";
import {
  ProviderAbortedError,
  throwIfAborted,
  type LlmProvider,
  type LlmResult,
  type MediaProbeProvider,
  type MediaProbeResult,
  type SttProvider,
  type SttResult,
  type TranslationProvider,
  type VisionProvider,
} from "./providers.js";
import { sampleProvenance } from "./testing/fixtures.js";

const ms = rational(1000, 1);

/** A fake vendor SDK response shape. It must never be visible through the capability interface. */
interface VendorSttResponse {
  request_id: string;
  utterances: { start_ms: number; end_ms: number; transcript: string; speaker: number }[];
}

function vendorCall(signal?: AbortSignal): Promise<VendorSttResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ request_id: "req_1", utterances: [{ start_ms: 0, end_ms: 900, transcript: "hello", speaker: 0 }] }), 5);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("vendor aborted"));
    });
  });
}

/** Example adapter: translates vendor payloads into canonical Core types at the boundary. */
const stt: SttProvider = {
  info: { name: "fake-stt", version: "1.0.0", model: "fake-large" },
  capabilities: { diarization: true, wordTimings: false },
  async transcribe(request, options = {}) {
    throwIfAborted(options.signal);
    let raw: VendorSttResponse;
    try {
      raw = await vendorCall(options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      throw error;
    }
    const speakerId = newEntityId();
    return {
      language: request.language ?? "en",
      speakers: [{ id: speakerId, label: "Speaker 1" }],
      segments: raw.utterances.map((u) => ({
        id: newEntityId(),
        range: { start: mediaTime(u.start_ms, ms), end: mediaTime(u.end_ms, ms) },
        text: u.transcript,
        speakerId,
      })),
      provenance: { ...sampleProvenance, provider: { name: "fake-stt", model: "fake-large", version: "1.0.0" } },
    };
  },
};

describe("provider capability interfaces", () => {
  it("lets an engine consume STT output as canonical Core types only", async () => {
    const result = await stt.transcribe({ mediaAssetId: newEntityId(), audioPath: "/tmp/a.wav", language: "en" });
    for (const s of result.segments) expect(TranscriptSegmentSchema.parse(s)).toEqual(s);
    expect(result.provenance.provider?.name).toBe("fake-stt");
    expectTypeOf<SttResult>().not.toHaveProperty("request_id");
    expectTypeOf<SttResult>().not.toHaveProperty("utterances");
    expectTypeOf<SttResult>().toHaveProperty("provenance");
  });

  it("propagates cancellation through AbortSignal as ProviderAbortedError", async () => {
    const controller = new AbortController();
    const pending = stt.transcribe({ mediaAssetId: newEntityId(), audioPath: "/tmp/a.wav" }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderAbortedError);
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(stt.transcribe({ mediaAssetId: newEntityId(), audioPath: "/tmp/a.wav" }, { signal: preAborted.signal })).rejects.toBeInstanceOf(ProviderAbortedError);
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it("exposes name/version/model metadata on every provider", () => {
    expect(stt.info).toEqual({ name: "fake-stt", version: "1.0.0", model: "fake-large" });
  });

  it("can be satisfied by minimal mocks for vision, LLM, translation and media probe", async () => {
    const vision: VisionProvider = {
      info: { name: "fake-vision", version: "0.1.0" },
      async analyze(request) {
        return {
          tags: request.kinds.map((kind) => ({ id: newEntityId(), mediaAssetId: request.mediaAssetId, kind, value: "unknown", confidence: 0.5, provenance: sampleProvenance })),
          provenance: sampleProvenance,
        };
      },
    };
    const llm: LlmProvider = {
      info: { name: "fake-llm", version: "0.1.0", model: "tiny" },
      async complete(request) {
        const out: LlmResult = { text: `echo:${request.prompt.user}`, provenance: sampleProvenance };
        return out;
      },
    };
    const translation: TranslationProvider = {
      info: { name: "fake-mt", version: "0.1.0" },
      async translate(request) {
        return { targetLanguage: request.targetLanguage, segments: request.segments.map((s) => ({ id: s.id, text: `[${request.targetLanguage}] ${s.text}` })), provenance: sampleProvenance };
      },
    };
    const probe: MediaProbeProvider = {
      info: { name: "fake-probe", version: "0.1.0" },
      async probe() {
        const result: MediaProbeResult = {
          duration: mediaTime(2400, FPS_23_976),
          video: { frameRate: FPS_23_976, width: 1920, height: 1080 },
          audio: { sampleRate: 48000, channels: 2 },
          fingerprint: { algorithm: "sha256", value: "f".repeat(64), sizeBytes: 10, strategy: "sampled" },
        };
        return result;
      },
    };

    const tags = await vision.analyze({ mediaAssetId: newEntityId(), framePaths: ["/tmp/f1.png"], kinds: ["scene"] });
    for (const t of tags.tags) expect(AnalysisTagSchema.parse(t)).toEqual(t);
    expect((await llm.complete({ prompt: { id: "p", version: "1", user: "hi" } })).text).toBe("echo:hi");
    expect((await translation.translate({ sourceLanguage: "en", targetLanguage: "ko", segments: [{ id: "s1", text: "hi" }] })).segments[0]?.text).toBe("[ko] hi");
    expect((await probe.probe({ path: "/tmp/a.mov" })).duration.ticks).toBe(2400);
  });
});
