import { createHelperClient, HELPER_PROTOCOL_VERSION } from "@pea/helper-protocol";
import {
  createSubtitleDocument, currentTranscript, exportSubtitleDocument, mergeSubtitleCues,
  serializeSubtitleDocument, splitSubtitleCue, updateSubtitleCue,
  type SubtitleOrigin
} from "@pea/transcript";
import { createHelperTranscriptProvider } from "./helper-provider.js";
import { readSelectedPremiereTranscript, type PremiereSourceHost } from "./source-controller.js";
import { SubtitleSession, cueEnd, formatSubtitleTime, parseSubtitleTime, subtitleRange } from "./session.js";

interface PickedFile {
  readonly name: string;
  readonly nativePath?: string;
  read(): Promise<string>;
  write(text: string): Promise<unknown>;
}
interface UxpFileSystem {
  getFileForOpening(options: { types: string[] }): Promise<PickedFile | null>;
  getFileForSaving(name: string, options: { types: string[] }): Promise<PickedFile | null>;
}

/** Browser/UXP UI only. Host and disk access are confined to injected boundaries. */
export function installSubtitlePanel(input: { ppro: PremiereSourceHost; fs: UxpFileSystem; document?: Document }) {
  const dom = input.document ?? document;
  const session = new SubtitleSession();
  let helper: ReturnType<typeof createHelperClient> | undefined;
  let selectedCueId: string | undefined;
  let editorKey = "";
  let uiBusy = false, cancellable = false, generation = 0, serial = 0;

  const el = (id: string): HTMLElement => {
    const value = dom.getElementById(id);
    if (!value) throw new Error(`missing Subtitle UI element: ${id}`);
    return value;
  };
  const field = (id: string) => el(id) as HTMLInputElement;
  const value = (id: string) => field(id).value;
  const button = (id: string) => el(id) as HTMLButtonElement;
  const freshId = () => `subtitle:${Date.now()}:${++serial}:${Math.random().toString(36).slice(2)}`;
  const kind = (): "source" | "sequence" => value("origin-kind") === "sequence" ? "sequence" : "source";
  const clear = (node: HTMLElement) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const show = (id: string, visible: boolean) => el(id).classList.toggle("hidden", !visible);
  const text = (id: string, content: string) => { el(id).textContent = content; };
  function status(message: string, error = false) {
    text("status", message);
    el("status").parentElement?.classList.toggle("error", error);
  }
  function fail(error: unknown) {
    status(error instanceof Error ? error.message : String(error), true);
  }

  function controls(active = session.active) {
    for (const element of Array.from(dom.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("button, input, select, textarea"))) {
      element.disabled = uiBusy;
    }
    button("cancel").disabled = !uiBusy || !cancellable;
    button("media-transcribe").disabled = uiBusy || !helper;
    button("premiere-read").disabled = uiBusy || kind() !== "source";
    button("premiere-transcribe").disabled = uiBusy || kind() !== "source";
    for (const id of ["document-save", "srt-export", "vtt-export"]) button(id).disabled = uiBusy || !active;
    show("sequence-options", kind() === "sequence");
    show("source-actions", kind() === "source");
    const cues = active ? currentTranscript(active).segments : [];
    const index = cues.findIndex(cue => cue.id === selectedCueId);
    for (const id of ["cue-save", "cue-split"]) button(id).disabled = uiBusy || index < 0;
    button("cue-merge").disabled = uiBusy || index < 0 || index === cues.length - 1;
  }

  function localAction(action: () => void) {
    if (uiBusy) return;
    try { action(); render(); } catch (error) { fail(error); }
  }
  function on(id: string, event: string, action: () => void) { el(id).addEventListener(event, action); }

  async function perform(message: string, action: (isCurrent: () => boolean) => Promise<string | undefined>, canCancel = true) {
    if (uiBusy) return;
    const operation = ++generation;
    uiBusy = true; cancellable = canCancel; status(message); controls();
    const isCurrent = () => operation === generation;
    try {
      const result = await action(isCurrent);
      if (isCurrent()) status(result ?? "작업을 취소했습니다.");
    } catch (error) {
      if (isCurrent()) {
        if (error instanceof Error && error.name === "AbortError") status("작업을 취소했습니다.");
        else fail(error);
      }
    } finally {
      if (isCurrent()) { uiBusy = false; cancellable = false; render(); }
    }
  }

  function cancel() {
    generation++;
    session.cancelPending();
    uiBusy = false; cancellable = false;
    status("작업을 취소했습니다."); controls();
  }

  function selected() {
    const active = session.active;
    if (!active) throw new Error("먼저 자막 문서를 선택하세요.");
    const cues = currentTranscript(active).segments;
    const index = cues.findIndex(cue => cue.id === selectedCueId);
    if (index < 0) throw new Error("수정할 자막을 선택하세요.");
    return { active, cue: cues[index], next: cues[index + 1] };
  }

  function renderSearch() {
    const list = el("search-results"); clear(list);
    const query = value("search");
    if (!query.trim()) return;
    const matches = session.search(query);
    const summary = dom.createElement("p"); summary.className = "hint";
    summary.textContent = matches.length > 200 ? `${matches.length}개 결과 중 처음 200개입니다. 검색어를 더 입력하세요.` : `${matches.length}개 결과`;
    list.appendChild(summary);
    for (const match of matches.slice(0, 200)) {
      const row = dom.createElement("button"); row.className = "search-row";
      row.textContent = `${match.kind === "source" ? "원본" : "편집본"} · ${match.label} · ${formatSubtitleTime(match.segment.range.start)}초\n${match.segment.text}`;
      row.disabled = uiBusy;
      row.addEventListener("click", () => localAction(() => {
        session.selectDocument(match.documentId); selectedCueId = match.segment.id;
      }));
      list.appendChild(row);
    }
  }

  function render() {
    const documents = session.documents, active = session.active;
    text("library-count", String(documents.length));
    const library = el("document-list"); clear(library);
    if (!documents.length) {
      const empty = dom.createElement("p"); empty.className = "hint"; empty.textContent = "아직 가져온 문서가 없습니다."; library.appendChild(empty);
    }
    for (const doc of documents) {
      const row = dom.createElement("button"); row.className = `document-row${doc.id === active?.id ? " selected" : ""}`;
      row.textContent = `${doc.origin.kind === "source" ? "원본" : "편집본"} · ${doc.origin.label}`;
      row.addEventListener("click", () => localAction(() => { session.selectDocument(doc.id); selectedCueId = undefined; }));
      library.appendChild(row);
    }
    const list = el("cue-list"); clear(list);
    const cues = active ? currentTranscript(active).segments : [];
    if (!cues.some(cue => cue.id === selectedCueId)) selectedCueId = cues[0]?.id;
    text("document-summary", active
      ? `${active.origin.label} · ${cues.length}개 자막 · 수정 ${active.revisions.length - 1}회${active.origin.kind === "sequence" ? ` · 내보내기 시작 ${formatSubtitleTime(active.origin.timelineStart!)}초` : ""}`
      : "문서를 선택하세요.");
    for (const [index, cue] of cues.entries()) {
      const row = dom.createElement("button"); row.className = `cue-row${cue.id === selectedCueId ? " selected" : ""}`;
      const meta = dom.createElement("span"); meta.className = "row-meta";
      meta.textContent = `${index + 1} · ${formatSubtitleTime(cue.range.start)} → ${formatSubtitleTime(cueEnd(cue))}초${cue.speakerId ? ` · ${cue.speakerId}` : ""}`;
      const body = dom.createElement("span"); body.textContent = cue.text;
      row.appendChild(meta); row.appendChild(body);
      row.addEventListener("click", () => localAction(() => { selectedCueId = cue.id; }));
      list.appendChild(row);
    }
    const cue = cues.find(cue => cue.id === selectedCueId);
    show("cue-editor", Boolean(cue));
    const key = JSON.stringify([active?.id, active?.currentRevisionId, selectedCueId]);
    if (cue && key !== editorKey) {
      field("cue-start").value = formatSubtitleTime(cue.range.start);
      field("cue-end").value = formatSubtitleTime(cueEnd(cue));
      field("cue-speaker").value = cue.speakerId ?? "";
      field("cue-text").value = cue.text;
      field("split-time").value = "";
      field("split-left").value = cue.text;
      field("split-right").value = "";
    }
    editorKey = key;
    renderSearch(); controls(active);
  }

  function fileOrigin(file: PickedFile, mediaAssetId: string): SubtitleOrigin {
    const origin: SubtitleOrigin = {
      kind: kind(), mediaAssetId, label: file.name, inputRevision: new Date().toISOString()
    };
    if (origin.kind === "sequence") origin.timelineStart = parseSubtitleTime(value("timeline-start"));
    return origin;
  }
  async function readPremiere(allowTranscription: boolean) {
    if (kind() !== "source") throw new Error("Premiere 클립 전사는 원본 모드에서 읽을 수 있습니다.");
    const done = await session.load(async signal => {
      const result = await readSelectedPremiereTranscript(input.ppro, { allowTranscription, signal });
      return createSubtitleDocument({
        id: freshId(), source: "premiere", transcript: result.snapshot.transcript,
        origin: { kind: "source", mediaAssetId: result.mediaAssetId, label: result.label, inputRevision: new Date().toISOString() },
        rawSourceJSON: result.snapshot.rawJSON
      });
    });
    return done ? "선택한 원본 클립의 대사를 불러왔습니다." : undefined;
  }

  on("origin-kind", "change", () => controls());
  on("search", "input", () => { try { renderSearch(); } catch (error) { fail(error); } });
  on("cancel", "click", cancel);
  on("premiere-read", "click", () => { void perform("Premiere에서 기존 전사를 읽는 중…", () => readPremiere(false)); });
  on("premiere-transcribe", "click", () => { void perform("Premiere 전사를 요청하는 중…", () => readPremiere(true)); });
  on("helper-connect", "click", () => { void perform("Helper 연결 정보를 읽는 중…", async isCurrent => {
    const file = await input.fs.getFileForOpening({ types: ["json"] });
    if (!file || !isCurrent()) return;
    const candidate = createHelperClient(JSON.parse(await file.read()));
    if (!isCurrent()) return;
    const health = await candidate.health() as { status: string; protocolVersion: string; helperVersion: string; capabilities?: { transcription?: boolean } };
    if (!isCurrent()) return;
    if (health.status !== "ok" || typeof health.protocolVersion !== "string" || health.protocolVersion.split(".")[0] !== HELPER_PROTOCOL_VERSION.split(".")[0]) {
      throw new Error("Helper 상태 또는 프로토콜 버전을 확인할 수 없습니다.");
    }
    if (health.capabilities?.transcription === false) throw new Error("이 Helper에는 전사 엔진이 설정되지 않았습니다.");
    helper = candidate;
    text("helper-status", `연결됨 · ${health.helperVersion}`);
    return "로컬 전사 Helper에 연결했습니다.";
  }); });
  on("media-transcribe", "click", () => { void perform("로컬 전사 파일을 선택하세요…", async isCurrent => {
    const client = helper;
    if (!client) throw new Error("먼저 Helper 연결 JSON을 선택하세요.");
    // Validate explicit sequence placement before queueing any native work.
    if (kind() === "sequence") parseSubtitleTime(value("timeline-start"));
    const file = await input.fs.getFileForOpening({ types: ["mov", "mp4", "mxf", "wav", "mp3", "m4a", "aiff", "flac"] });
    if (!file || !isCurrent()) return;
    if (typeof file.nativePath !== "string" || !file.nativePath.trim()) throw new Error("선택한 파일의 로컬 경로를 읽을 수 없습니다.");
    const id = freshId(), mediaAssetId = `${id}:media`, origin = fileOrigin(file, mediaAssetId);
    const mediaPath = file.nativePath;
    status("전체 파일의 첫 오디오 스트림을 전사하는 중…");
    const done = await session.load(async signal => createSubtitleDocument({
      id, origin, source: "whisper-cpp",
      transcript: await createHelperTranscriptProvider(client).transcribe({ mediaAssetId, mediaPath, signal })
    }));
    return done ? "파일 전사를 문서에 추가했습니다." : undefined;
  }); });
  on("subtitle-import", "click", () => { void perform("SRT 또는 VTT 파일을 선택하세요…", async isCurrent => {
    if (kind() === "sequence") parseSubtitleTime(value("timeline-start"));
    const file = await input.fs.getFileForOpening({ types: ["srt", "vtt"] });
    if (!file || !isCurrent()) return;
    const format = file.name.toLowerCase().endsWith(".srt") ? "srt" : file.name.toLowerCase().endsWith(".vtt") ? "vtt" : undefined;
    if (!format) throw new Error("SRT 또는 VTT 확장자의 파일을 선택하세요.");
    const content = await file.read();
    if (!isCurrent()) return;
    const id = freshId();
    session.importSubtitle({ id, origin: fileOrigin(file, `${id}:media`), text: content, format });
    return "자막 파일을 문서에 추가했습니다.";
  }); });
  on("document-open", "click", () => { void perform("자막 문서 JSON을 선택하세요…", async isCurrent => {
    const file = await input.fs.getFileForOpening({ types: ["json"] });
    if (!file || !isCurrent()) return;
    const content = await file.read();
    if (!isCurrent()) return;
    session.openDocument(content);
    return "원본과 수정 이력을 불러왔습니다.";
  }); });

  on("cue-save", "click", () => localAction(() => {
    const { cue } = selected();
    session.editActive(doc => updateSubtitleCue(doc, {
      segmentId: cue.id, text: value("cue-text"), range: subtitleRange(value("cue-start"), value("cue-end")),
      speakerId: value("cue-speaker").trim() || null
    }));
    status("자막 수정을 이력에 추가했습니다. JSON 저장으로 파일에 보관하세요.");
  }));
  on("cue-split", "click", () => localAction(() => {
    const { cue } = selected();
    session.editActive(doc => splitSubtitleCue(doc, {
      segmentId: cue.id, splitAt: parseSubtitleTime(value("split-time")), leftText: value("split-left"), rightText: value("split-right")
    }));
    status("두 자막으로 분할했습니다.");
  }));
  on("cue-merge", "click", () => localAction(() => {
    const { cue, next } = selected();
    if (!next) throw new Error("병합할 다음 자막이 없습니다.");
    session.editActive(doc => mergeSubtitleCues(doc, { firstSegmentId: cue.id, secondSegmentId: next.id }));
    status("다음 자막과 병합했습니다.");
  }));

  function save(format: "json" | "srt" | "vtt") {
    return perform("저장할 위치를 선택하세요…", async isCurrent => {
      const active = session.active;
      if (!active) throw new Error("저장할 문서를 선택하세요.");
      const content = format === "json" ? serializeSubtitleDocument(active) : exportSubtitleDocument(active, format);
      const stem = active.origin.label.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_") || "subtitle";
      const filename = `${stem}.${format === "json" ? "subtitle.json" : format}`;
      const file = await input.fs.getFileForSaving(filename, { types: [format] });
      if (!file || !isCurrent()) return;
      await file.write(content);
      return `${file.name} 저장 완료`;
    }, false);
  }
  on("document-save", "click", () => { void save("json"); });
  on("srt-export", "click", () => { void save("srt"); });
  on("vtt-export", "click", () => { void save("vtt"); });
  render();
  return {
    show: () => render(),
    hide: () => { if (uiBusy && cancellable) cancel(); }
  };
}

const { entrypoints, storage } = require("uxp");
const ppro = require("premierepro");
let panel: ReturnType<typeof installSubtitlePanel> | undefined;
entrypoints.setup({ panels: { "pea-subtitle": {
  show() {
    if (!panel) panel = installSubtitlePanel({ ppro, fs: storage.localFileSystem });
    else panel.show();
  },
  hide() { panel?.hide(); }
} } });
