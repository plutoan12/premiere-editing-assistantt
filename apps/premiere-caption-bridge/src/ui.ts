import { prepareCaptionApplication } from "./prepare.js";

interface HostTarget { available: boolean; projectPath: string; sequenceId: string; sequenceName: string; }
interface CEPResult { err: number; data?: unknown; }
interface CEPFileSystem {
  ERR_NOT_FOUND: number;
  stat(path: string): { err: number; data?: { isDirectory(): boolean } };
  makedir(path: string): CEPResult;
  writeFile(path: string, text: string, encoding: string): CEPResult;
  readFile(path: string, encoding: string): CEPResult;
}
declare const CSInterface: { new(): {
  getSystemPath(type: string): string;
  evalScript(script: string, callback: (response: string) => void): void;
} };
declare const SystemPath: { USER_DATA: string };
declare global { interface Window { cep: { fs: CEPFileSystem; encoding: { UTF8: string } }; } }

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing panel element: ${id}`);
  return result as T;
}
const fileInput = element<HTMLInputElement>("document-file");
const refresh = element<HTMLButtonElement>("target-refresh");
const apply = element<HTMLButtonElement>("caption-apply");
const summary = element("document-summary"), targetSummary = element("target-summary");
const status = element("status"), artifactPath = element("artifact-path");
let cs: InstanceType<typeof CSInterface>;
let documentJSON = "", prepared: ReturnType<typeof prepareCaptionApplication> | undefined;
let busy = false, attempted = false, uncertain = false;

function renderControls(): void {
  fileInput.disabled = busy || uncertain;
  refresh.disabled = busy || uncertain || !documentJSON;
  apply.disabled = busy || uncertain || attempted || !prepared;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function recordKey(value: NonNullable<typeof prepared>): Promise<string> {
  if (!crypto.subtle?.digest) throw new Error("자막 내용의 해시를 확인할 수 없어 적용을 중단했습니다.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.srt));
  const contentHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `pea-caption-apply:${JSON.stringify([value.expectedProjectPath, value.expectedSequenceId, value.documentId, value.revisionId, contentHash])}`;
}
function requestId(): string {
  const values = crypto.getRandomValues(new Uint32Array(4));
  return [...values].map(value => value.toString(16).padStart(8, "0")).join("-");
}
function hostCall(script: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => { if (!settled) { settled = true; clearTimeout(timer); callback(); } };
    const timer = setTimeout(() => finish(() => reject(new Error("Premiere 응답을 확인하지 못했습니다."))), timeoutMs);
    try {
      cs.evalScript(script, response => finish(() => {
        try { resolve(JSON.parse(response)); } catch { reject(new Error("Premiere 응답을 확인하지 못했습니다.")); }
      }));
    } catch (error) { finish(() => reject(error)); }
  });
}
async function inspect(): Promise<HostTarget> {
  const value = await hostCall("PeaCaptionBridge.inspect()", 15000);
  if (!value || typeof value !== "object") throw new Error("Premiere의 활성 시퀀스를 확인할 수 없습니다.");
  const target = value as Partial<HostTarget>;
  if (target.available !== true || typeof target.projectPath !== "string" || !target.projectPath
      || typeof target.sequenceId !== "string" || !target.sequenceId || typeof target.sequenceName !== "string") {
    throw new Error("Premiere에서 프로젝트를 저장하고 캡션을 적용할 시퀀스를 활성화하세요.");
  }
  return target as HostTarget;
}
function readDocument(file: File): Promise<string> {
  if (file.size > 32 * 1024 * 1024) return Promise.reject(new Error("문서는 32 MB 이하로 열어 주세요."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("문서를 읽지 못했습니다."));
    reader.onerror = () => reject(new Error("문서를 읽지 못했습니다."));
    reader.onabort = () => reject(new Error("문서 읽기가 취소되었습니다."));
    reader.readAsText(file, "UTF-8");
  });
}
async function prepareDocument(): Promise<void> {
  const target = await inspect();
  const next = prepareCaptionApplication({ documentJSON, target, requestId: requestId() });
  attempted = localStorage.getItem(await recordKey(next)) !== null;
  prepared = next;
  summary.textContent = `${next.label} · 자막 ${next.cueCount}개`;
  targetSummary.textContent = `${next.sequenceName}\n${next.expectedProjectPath}\n시퀀스 ID: ${next.expectedSequenceId}`;
  status.textContent = attempted
    ? "이 문서 버전은 이 시퀀스에 이미 적용을 요청한 이력이 있습니다. Premiere에서 결과를 확인하세요."
    : "대상을 확인했습니다. 새 캡션 트랙 적용을 누르면 이 시퀀스에 자막을 추가합니다.";
}
function writeArtifact(value: NonNullable<typeof prepared>): string {
  const fs = window.cep.fs, encoding = window.cep.encoding.UTF8;
  const userData = cs.getSystemPath(SystemPath.USER_DATA).replace(/[\\/]+$/, "");
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(userData)) throw new Error("캡션 데이터 폴더 경로를 확인하지 못했습니다.");
  const folder = `${userData}/PeaCaptionBridge`;
  const found = fs.stat(folder);
  if (found.err !== 0) {
    if (found.err !== fs.ERR_NOT_FOUND || fs.makedir(folder).err !== 0) throw new Error("캡션 데이터 폴더를 만들지 못했습니다.");
  } else if (!found.data?.isDirectory()) throw new Error("캡션 데이터 경로가 폴더가 아닙니다.");
  const path = `${folder}/caption-${value.requestId}.srt`;
  if (fs.stat(path).err !== fs.ERR_NOT_FOUND) throw new Error("적용용 SRT 경로를 새로 확보하지 못했습니다.");
  if (fs.writeFile(path, value.srt, encoding).err !== 0) throw new Error("적용용 SRT를 저장하지 못했습니다.");
  const readBack = fs.readFile(path, encoding);
  if (readBack.err !== 0 || readBack.data !== value.srt) throw new Error("저장한 SRT 내용을 확인하지 못했습니다.");
  artifactPath.textContent = `적용용 SRT: ${path}`;
  return path;
}
async function run(action: () => Promise<void>): Promise<void> {
  if (busy || uncertain) return;
  busy = true; renderControls();
  try { await action(); } catch (error) { status.textContent = errorText(error); }
  finally { busy = false; renderControls(); }
}

fileInput.addEventListener("change", () => { void run(async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  prepared = undefined; attempted = false; documentJSON = "";
  summary.textContent = file.name; targetSummary.textContent = "대상을 확인하고 있습니다."; artifactPath.textContent = "";
  documentJSON = await readDocument(file);
  await prepareDocument();
}); });
refresh.addEventListener("click", () => { void run(async () => {
  prepared = undefined; attempted = false;
  await prepareDocument();
}); });
apply.addEventListener("click", () => { void run(async () => {
  const value = prepared;
  if (!value || attempted) return;
  const currentTarget = await inspect();
  if (currentTarget.projectPath !== value.expectedProjectPath || currentTarget.sequenceId !== value.expectedSequenceId) {
    prepared = undefined;
    throw new Error("활성 프로젝트 또는 시퀀스가 바뀌었습니다. 현재 시퀀스로 다시 확인하세요.");
  }
  // Re-check the persistent record immediately before dispatch, including changes by another panel instance.
  const key = await recordKey(value);
  if (localStorage.getItem(key) !== null) {
    attempted = true;
    throw new Error("이미 적용을 요청한 문서입니다. Premiere에서 결과를 확인하세요.");
  }
  const srtPath = writeArtifact(value);
  localStorage.setItem(key, JSON.stringify({ requestId: value.requestId, status: "pending", srtPath }));
  attempted = true;
  status.textContent = "새 캡션 트랙을 적용하고 있습니다. Premiere 응답을 기다려 주세요.";
  const payload = { requestId: value.requestId, expectedProjectPath: value.expectedProjectPath,
    expectedSequenceId: value.expectedSequenceId, srtPath, cueCount: value.cueCount };
  // A JSON string argument avoids interpolating document text or file paths into executable source.
  const argument = JSON.stringify(JSON.stringify(payload)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  try {
    const result = await hostCall(`PeaCaptionBridge.apply(${argument})`, 60000) as Record<string, unknown> | null;
    if (!result || result.requestId !== value.requestId || !["applied", "failed", "blocked", "unknown"].includes(String(result.status))) {
      throw new Error("Premiere 응답을 확인하지 못했습니다.");
    }
    if (result.status === "unknown") throw new Error("Premiere 적용 결과를 확인하지 못했습니다.");
    localStorage.setItem(key, JSON.stringify({ requestId: value.requestId, status: result.status, srtPath }));
    status.textContent = result.status === "applied"
      ? "Premiere가 새 캡션 트랙 생성을 확인했습니다. 타임라인에서 자막과 시간을 확인하세요."
      : `적용이 완료되지 않았습니다. ${typeof result.message === "string" ? result.message : "Premiere에서 결과를 확인하세요."} 같은 요청은 다시 전송하지 않습니다.`;
  } catch {
    uncertain = true;
    status.textContent = "적용 결과를 확인하지 못했습니다. 자동으로 다시 적용하지 않습니다. Premiere의 캡션 트랙을 먼저 확인하세요.";
  }
}); });

try { cs = new CSInterface(); renderControls(); }
catch { uncertain = true; status.textContent = "Premiere Pro의 캡션 확장 패널에서 열어 주세요."; renderControls(); }
