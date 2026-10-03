const { entrypoints, storage } = require("uxp");
const fs = storage.localFileSystem;

let session = null;
let currentJob = null;
let listenersInstalled = false;

function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function setDisabled(id, value) { const el = document.getElementById(id); if (el) el.disabled = value; }

function parseBootstrap(value) {
  if (!value || typeof value !== "object") throw new Error("잘못된 helper bootstrap");
  const { endpoint, token, protocolVersion, helperVersion } = value;
  if (typeof endpoint !== "string" || typeof token !== "string" || typeof protocolVersion !== "string" || typeof helperVersion !== "string") throw new Error("bootstrap 필드가 부족함");
  const url = new URL(endpoint);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("helper는 loopback만 허용");
  if (url.protocol !== "https:") throw new Error("배포 패널은 HTTPS helper만 허용");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("helper token이 유효하지 않음");
  if (protocolVersion.split(".")[0] !== "1") throw new Error("helper protocol 버전 불일치");
  return { endpoint: url.origin, token, protocolVersion, helperVersion };
}
async function request(path, init = {}) {
  if (!session) throw new Error("helper 연결 필요");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(session.endpoint + path, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", "authorization": `Bearer ${session.token}`, ...(init.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `helper HTTP ${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}
async function connect() {
  const file = await fs.getFileForOpening({ types: ["json"] });
  if (!file) return;
  const candidate = parseBootstrap(JSON.parse(await file.read()));
  session = candidate;
  const health = await request("/health");
  if (String(health.protocolVersion).split(".")[0] !== "1") throw new Error("helper protocol 버전 불일치");
  setText("status", `Helper ${health.helperVersion} 연결됨`);
  setDisabled("transcribe", false);
}
async function transcribe() {
  const file = await fs.getFileForOpening({ types: ["mov", "mp4", "mxf", "wav", "mp3", "m4a"] });
  if (!file) return;
  setDisabled("transcribe", true); setDisabled("cancel", false); setText("result", "전사 시작…");
  const mediaAssetId = crypto.randomUUID();
  const submitted = await request("/v1/transcriptions", { method: "POST", body: JSON.stringify({ mediaAssetId, mediaPath: file.nativePath }) });
  currentJob = submitted.jobId;
  try {
    for (;;) {
      const job = await request(`/v1/jobs/${encodeURIComponent(currentJob)}`);
      setText("status", `Helper 작업: ${job.status} ${Math.round((job.progress || 0) * 100)}%`);
      if (job.status === "completed") {
        setText("result", job.result.transcript.segments.map(s => s.text).join("\n"));
        return;
      }
      if (job.status === "failed") throw new Error(job.error?.message || "전사 실패");
      if (job.status === "cancelled") { setText("result", "취소됨"); return; }
      await new Promise(r => setTimeout(r, 500));
    }
  } finally {
    currentJob = null; setDisabled("transcribe", false); setDisabled("cancel", true);
  }
}
async function cancel() {
  if (!currentJob) return;
  await request(`/v1/jobs/${encodeURIComponent(currentJob)}/cancel`, { method: "POST", body: "{}" });
}
function guard(fn) { return async () => { try { await fn(); } catch (e) { setText("status", "오류"); setText("result", e instanceof Error ? e.message : String(e)); } }; }

entrypoints.setup({
  panels: {
    "pea-main": {
      show() {
        if (listenersInstalled) return;
        listenersInstalled = true;
        document.getElementById("connect")?.addEventListener("click", guard(connect));
        document.getElementById("transcribe")?.addEventListener("click", guard(transcribe));
        document.getElementById("cancel")?.addEventListener("click", guard(cancel));
      }
    }
  }
});
