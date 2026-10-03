import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { Transcript } from "@pea/core";
import { HELPER_PROTOCOL_VERSION, type HelperJob, type SerializedTranscript } from "@pea/helper-protocol";
import type { TranscriptProvider } from "@pea/transcript";
import type { MediaProvider } from "@pea/rough-media/wire";
import { createAudioRoutes } from "./audio-routes.js";

export interface HelperTLS { key: string | Buffer; cert: string | Buffer; }
export interface HelperServerOptions {
  provider?: TranscriptProvider;
  mediaProvider?: MediaProvider;
  helperVersion?: string;
  token?: string;
  tls?: HelperTLS;
  allowInsecureDev?: boolean;
  maxBodyBytes?: number;
  maxJobs?: number;
}

function serializeTranscript(transcript: Transcript): SerializedTranscript {
  return {
    id: transcript.id,
    segments: transcript.segments.map(s => ({
      id: s.id, mediaAssetId: s.mediaAssetId, text: s.text, ...(s.speakerId ? { speakerId: s.speakerId } : {}),
      range: {
        start: { ticks: s.range.start.ticks.toString(), timebase: s.range.start.timebase },
        duration: { ticks: s.range.duration.ticks.toString(), timebase: s.range.duration.timebase }
      }
    }))
  };
}
function tokenOK(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS"
  });
  res.end(payload);
}
async function readJSON(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length; if (size > maxBytes) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(b);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Object.assign(new Error("JSON object required"), { status: 400 });
  return parsed as Record<string, unknown>;
}
function publicJob(job: InternalJob): HelperJob {
  return { id: job.id, status: job.status, progress: job.progress, ...(job.result ? { result: { transcript: job.result } } : {}), ...(job.error ? { error: job.error } : {}) };
}
interface InternalJob {
  id: string;
  status: HelperJob["status"];
  progress: number;
  controller: AbortController;
  result?: SerializedTranscript;
  error?: HelperJob["error"];
  task?: Promise<void>;
}

export async function startHelperServer(options: HelperServerOptions) {
  if (!options.tls && !options.allowInsecureDev) throw new Error("TLS is required outside explicit development mode");
  const token = options.token ?? randomBytes(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("invalid helper session token");
  const helperVersion = options.helperVersion ?? "0.2.0";
  const maxBody = options.maxBodyBytes ?? 64 * 1024;
  const maxJobs = options.maxJobs ?? 128;
  const jobs = new Map<string, InternalJob>();
  const audio = options.mediaProvider ? createAudioRoutes(options.mediaProvider, { maxBodyBytes: maxBody }) : undefined;

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "OPTIONS") { json(res, 204, {}); return; }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { status: "ok", protocolVersion: HELPER_PROTOCOL_VERSION, helperVersion, capabilities: { transcription: !!options.provider, roughCut: !!audio } }); return;
      }
      if (!tokenOK(req.headers.authorization, token)) { json(res, 401, { error: "unauthorized" }); return; }
      if (audio && await audio.handle(req, res)) return;

      if (req.method === "POST" && url.pathname === "/v1/transcriptions") {
        const provider = options.provider;
        if (!provider) { json(res, 503, { error: "transcription provider not configured; rough-cut does not require a speech model" }); return; }
        if (jobs.size >= maxJobs) { json(res, 429, { error: "job limit reached" }); return; }
        const body = await readJSON(req, maxBody);
        if (typeof body.mediaAssetId !== "string" || !body.mediaAssetId.trim() || typeof body.mediaPath !== "string" || !body.mediaPath.trim()) {
          json(res, 400, { error: "mediaAssetId and mediaPath are required" }); return;
        }
        const id = randomBytes(16).toString("hex");
        const controller = new AbortController();
        const job: InternalJob = { id, status: "queued", progress: 0, controller };
        jobs.set(id, job);
        job.task = Promise.resolve().then(async () => {
          if (job.status === "cancelled") return;
          job.status = "running"; job.progress = 0.05;
          try {
            const transcript = await provider.transcribe({ mediaAssetId: body.mediaAssetId as string, mediaPath: body.mediaPath as string, signal: controller.signal });
            if (controller.signal.aborted) { job.status = "cancelled"; job.progress = 1; return; }
            job.result = serializeTranscript(transcript); job.status = "completed"; job.progress = 1;
          } catch (error) {
            if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
              job.status = "cancelled"; job.progress = 1;
            } else {
              job.status = "failed"; job.progress = 1;
              job.error = { code: error instanceof Error ? error.name || "Error" : "Error", message: error instanceof Error ? error.message : "helper job failed" };
            }
          }
        });
        json(res, 202, { jobId: id }); return;
      }

      const match = /^\/v1\/jobs\/([A-Za-z0-9_-]+)(\/cancel)?$/.exec(url.pathname);
      if (match) {
        const job = jobs.get(match[1]);
        if (!job) { json(res, 404, { error: "job not found" }); return; }
        if (req.method === "GET" && !match[2]) { json(res, 200, publicJob(job)); return; }
        if (req.method === "POST" && match[2]) {
          if (job.status === "queued" || job.status === "running") { job.controller.abort(); job.status = "cancelled"; job.progress = 1; }
          json(res, 200, { cancelled: job.status === "cancelled" }); return;
        }
      }
      json(res, 404, { error: "not found" });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error && typeof (error as { status: unknown }).status === "number" ? (error as { status: number }).status : 400;
      json(res, status, { error: error instanceof Error ? error.message : "bad request" });
    }
  };

  const server = options.tls ? createHttpsServer(options.tls, handler) : createHttpServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address() as AddressInfo;
  const endpoint = `${options.tls ? "https" : "http"}://127.0.0.1:${address.port}`;
  return {
    endpoint, token, protocolVersion: HELPER_PROTOCOL_VERSION, helperVersion,
    stop: async () => {
      for (const job of jobs.values()) job.controller.abort();
      await audio?.stop(); await Promise.allSettled([...jobs.values()].map(job => job.task));
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}
