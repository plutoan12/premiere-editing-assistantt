import { describe, expect, it } from "vitest";
import type { TranscriptProvider } from "@pea/transcript";
import { createHelperClient } from "@pea/helper-protocol";
import { startHelperServer } from "./server.js";

const transcript = {
  id: "t1",
  segments: [{ id: "s1", mediaAssetId: "m1", range: { start: { ticks: 0n, timebase: { numerator: 1, denominator: 1000 } }, duration: { ticks: 1000n, timebase: { numerator: 1, denominator: 1000 } } }, text: "hello" }]
};

describe("native helper transport", () => {
  it("refuses insecure serving unless explicitly development-only", async () => {
    const provider: TranscriptProvider = { kind: "whisper-cpp", transcribe: async () => transcript };
    await expect(startHelperServer({ provider })).rejects.toThrow(/TLS/);
  });

  it("authenticates jobs and serializes bigint transcript time", async () => {
    const provider: TranscriptProvider = { kind: "whisper-cpp", transcribe: async () => transcript };
    const helper = await startHelperServer({ provider, allowInsecureDev: true });
    try {
      const unauthorized = await fetch(helper.endpoint + "/v1/jobs/nope");
      expect(unauthorized.status).toBe(401);
      const client = createHelperClient({ endpoint: helper.endpoint, token: helper.token, protocolVersion: helper.protocolVersion, helperVersion: helper.helperVersion }, { allowInsecureDev: true });
      const { jobId } = await client.submitTranscription({ mediaAssetId: "m1", mediaPath: "/tmp/input.mov" });
      let job = await client.getJob(jobId);
      for (let i = 0; i < 20 && job.status !== "completed"; i++) {
        await new Promise(r => setTimeout(r, 5)); job = await client.getJob(jobId);
      }
      expect(job.status).toBe("completed");
      expect(job.result?.transcript.segments[0].range.duration.ticks).toBe("1000");
    } finally { await helper.stop(); }
  });

  it("propagates cancellation into provider signal", async () => {
    let aborted = false;
    const provider: TranscriptProvider = { kind: "whisper-cpp", transcribe: async input => new Promise((_, reject) => {
      input.signal?.addEventListener("abort", () => { aborted = true; const e = new Error("cancelled"); e.name = "AbortError"; reject(e); }, { once: true });
    }) };
    const helper = await startHelperServer({ provider, allowInsecureDev: true });
    try {
      const client = createHelperClient({ endpoint: helper.endpoint, token: helper.token, protocolVersion: helper.protocolVersion, helperVersion: helper.helperVersion }, { allowInsecureDev: true });
      const { jobId } = await client.submitTranscription({ mediaAssetId: "m1", mediaPath: "/tmp/input.mov" });
      await client.cancelJob(jobId);
      await new Promise(r => setTimeout(r, 5));
      expect(aborted).toBe(true);
      expect((await client.getJob(jobId)).status).toBe("cancelled");
    } finally { await helper.stop(); }
  });
});
