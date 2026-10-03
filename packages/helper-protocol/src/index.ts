export const HELPER_PROTOCOL_VERSION = "1.0";

export type HelperJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface HelperBootstrap {
  endpoint: string;
  token: string;
  protocolVersion: string;
  helperVersion: string;
}

export interface SerializedMediaTime {
  ticks: string;
  timebase: { numerator: number; denominator: number };
}
export interface SerializedTranscriptSegment {
  id: string;
  mediaAssetId: string;
  range: { start: SerializedMediaTime; duration: SerializedMediaTime };
  text: string;
  speakerId?: string;
}
export interface SerializedTranscript { id: string; segments: SerializedTranscriptSegment[]; }

export interface HelperJob {
  id: string;
  status: HelperJobStatus;
  progress: number;
  result?: { transcript: SerializedTranscript };
  error?: { code: string; message: string };
}

function assertLoopback(url: URL): void {
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") {
    throw new Error("helper endpoint must be loopback");
  }
}
export function parseHelperBootstrap(value: unknown, options: { allowInsecureDev?: boolean } = {}): HelperBootstrap {
  if (!value || typeof value !== "object") throw new Error("invalid helper bootstrap");
  const b = value as Record<string, unknown>;
  if (typeof b.endpoint !== "string" || typeof b.token !== "string" || typeof b.protocolVersion !== "string" || typeof b.helperVersion !== "string") {
    throw new Error("invalid helper bootstrap");
  }
  if (!/^[A-Za-z0-9_-]{32,}$/.test(b.token)) throw new Error("invalid helper session token");
  const url = new URL(b.endpoint);
  assertLoopback(url);
  if (url.protocol !== "https:" && !(options.allowInsecureDev && url.protocol === "http:")) {
    throw new Error("secure helper transport required");
  }
  if (b.protocolVersion.split(".")[0] !== HELPER_PROTOCOL_VERSION.split(".")[0]) throw new Error("incompatible helper protocol");
  return { endpoint: url.origin, token: b.token, protocolVersion: b.protocolVersion, helperVersion: b.helperVersion };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export function createHelperClient(bootstrapValue: unknown, options: { fetchImpl?: FetchLike; allowInsecureDev?: boolean; timeoutMs?: number } = {}) {
  const bootstrap = parseHelperBootstrap(bootstrapValue, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("invalid helper client timeout");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(bootstrap.endpoint + path, {
        ...init,
        signal: controller.signal,
        headers: { "content-type": "application/json", "authorization": `Bearer ${bootstrap.token}`, ...(init.headers ?? {}) }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `helper HTTP ${response.status}`;
        throw new Error(message);
      }
      return body as T;
    } finally { clearTimeout(timer); }
  }

  return {
    bootstrap,
    health: () => request<{ protocolVersion: string; helperVersion: string; status: "ok" }>("/health"),
    submitTranscription: (input: { mediaAssetId: string; mediaPath: string }) =>
      request<{ jobId: string }>("/v1/transcriptions", { method: "POST", body: JSON.stringify(input) }),
    getJob: (id: string) => request<HelperJob>(`/v1/jobs/${encodeURIComponent(id)}`),
    cancelJob: (id: string) => request<{ cancelled: boolean }>(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" })
  };
}
