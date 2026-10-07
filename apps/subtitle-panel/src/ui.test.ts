import { beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

let bundle: string, html: string;
beforeAll(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./ui.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "cjs", target: "es2022",
    external: ["uxp", "premierepro"]
  });
  bundle = result.outputFiles[0].text;
  html = await readFile(new URL("../index.html", import.meta.url), "utf8");
});

/** Only the DOM operations the real bundle uses; no document or editing logic is mocked. */
class Element {
  children: Element[] = [];
  parentElement?: Element;
  value = "";
  textContent = "";
  className = "";
  disabled = false;
  private listeners = new Map<string, Array<() => void>>();
  private classes = new Set<string>();
  classList = {
    toggle: (name: string, force?: boolean) => {
      if (force ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name);
    }
  };
  constructor(readonly tagName: string, readonly id = "") {}
  get firstChild() { return this.children[0]; }
  appendChild(child: Element) { child.parentElement = this; this.children.push(child); return child; }
  removeChild(child: Element) { this.children.splice(this.children.indexOf(child), 1); }
  addEventListener(name: string, action: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), action]);
  }
  emit(name = "click") {
    if (name === "click") assert.equal(this.disabled, false, `cannot click disabled ${this.id}`);
    for (const action of this.listeners.get(name) ?? []) action();
  }
  set innerHTML(_value: string) { throw new Error("unsafe HTML write instead of textContent"); }
}

interface OpenFile { name: string; read(): Promise<string>; }
function mount() {
  const elements = new Map<string, Element>(), allNodes: Element[] = [];
  const create = (tag: string, id = "") => { const element = new Element(tag, id); allNodes.push(element); return element; };
  for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) elements.set(match[2], create(match[1], match[2]));
  const element = (id: string) => {
    const result = elements.get(id); assert.ok(result, `missing HTML element ${id}`); return result;
  };
  element("origin-kind").value = "source";
  const opened: OpenFile[] = [], writes: Array<{ name: string; text: string }> = [];
  const fs = {
    async getFileForOpening() { return opened.shift() ?? null; },
    async getFileForSaving(name: string) { return { name, write: async (text: string) => { writes.push({ name, text }); } }; }
  };
  let lifecycle!: { show(): void; hide(): void };
  const document = {
    getElementById: (id: string) => elements.get(id), createElement: (tag: string) => create(tag),
    querySelectorAll: () => allNodes.filter(element => ["input", "select", "textarea", "button"].includes(element.tagName))
  };
  // UXP and Premiere are the external host boundary. All application code is real.
  const context = vm.createContext({
    console, setTimeout, clearTimeout, AbortController, URL, document, exports: {}, module: { exports: {} },
    require(id: string) {
      if (id === "uxp") return { entrypoints: { setup: (registration: { panels: Record<string, typeof lifecycle> }) => { lifecycle = registration.panels["pea-subtitle"]; } }, storage: { localFileSystem: fs } };
      if (id === "premierepro") return {};
      throw new Error(`unexpected runtime dependency ${id}`);
    }
  });
  vm.runInContext(bundle, context);
  lifecycle.show();
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  const click = async (id: string) => { element(id).emit(); await flush(); };
  const importSrt = async (name: string, text: string) => {
    opened.push({ name, read: async () => text }); await click("subtitle-import");
  };
  return { element, opened, writes, fs, lifecycle, click, flush, importSrt };
}

const srt = (text: string) => `1\n00:00:01,000 --> 00:00:03,000\n${text}\n`;

describe("bundled Subtitle UI with host boundaries", () => {
  it("edits, splits and merges through buttons while saving the untouched master with revision history", async () => {
    const ui = mount();
    await ui.importSrt("interview.srt", srt("안녕하세요"));
    assert.equal(ui.element("library-count").textContent, "1");
    assert.equal(ui.element("cue-text").value, "안녕하세요");
    ui.element("cue-text").value = "<img src=x onerror=evil>";
    await ui.click("cue-save");
    assert.match(ui.element("document-summary").textContent, /수정 1회/);
    assert.equal(ui.element("cue-list").children[0].children[1].textContent, "<img src=x onerror=evil>");
    ui.element("split-time").value = "2";
    ui.element("split-left").value = "앞 문장";
    ui.element("split-right").value = "뒤 문장";
    await ui.click("cue-split");
    assert.equal(ui.element("cue-list").children.length, 2);
    await ui.click("cue-merge");
    assert.equal(ui.element("cue-list").children.length, 1);
    await ui.click("document-save");
    const saved = JSON.parse(ui.writes[0].text);
    assert.equal(ui.writes[0].name, "interview.subtitle.json");
    assert.equal(saved.revisions.length, 4);
    assert.equal(saved.revisions[0].transcript.segments[0].text, "안녕하세요");
    assert.equal(saved.revisions[3].transcript.segments[0].text, "앞 문장\n뒤 문장");
    await ui.click("srt-export");
    assert.equal(ui.writes[1].text, "1\n00:00:01,000 --> 00:00:03,000\n앞 문장\n뒤 문장\n");
  });

  it("searches source and sequence documents and adds the explicit sequence offset only at export", async () => {
    const ui = mount();
    await ui.importSrt("source.srt", srt("공통 대사"));
    ui.element("origin-kind").value = "sequence";
    ui.element("origin-kind").emit("change");
    assert.equal(ui.element("premiere-read").disabled, true);
    // A missing explicit sequence start must reject the operation before opening a file.
    await ui.click("subtitle-import");
    assert.equal(ui.element("library-count").textContent, "1");
    ui.element("timeline-start").value = "5.5";
    await ui.importSrt("render.srt", srt("공통 대사"));
    assert.equal(ui.element("library-count").textContent, "2");
    assert.equal(ui.element("cue-start").value, "1");
    await ui.click("srt-export");
    assert.match(ui.writes[0].text, /00:00:06,500 --> 00:00:08,500/);
    await ui.click("vtt-export");
    assert.match(ui.writes[1].text, /00:00:06\.500 --> 00:00:08\.500/);
    ui.element("search").value = "공통";
    ui.element("search").emit("input");
    const results = ui.element("search-results").children;
    assert.equal(results[0].textContent, "2개 결과");
    assert.match(results[1].textContent, /원본 · source.srt/);
    assert.match(results[2].textContent, /편집본 · render.srt/);
    results[1].emit();
    assert.match(ui.element("document-summary").textContent, /source.srt/);
    ui.opened.push({ name: "bad.json", read: async () => '{"bad":true}' });
    await ui.click("document-open");
    assert.equal(ui.element("library-count").textContent, "2");
    assert.match(ui.element("document-summary").textContent, /source.srt/);
  });

  it("keeps the existing document when a file read completes after the panel is hidden", async () => {
    const ui = mount();
    await ui.importSrt("existing.srt", srt("유지할 대사"));
    let finishRead!: (text: string) => void;
    ui.opened.push({ name: "late.srt", read: () => new Promise(resolve => { finishRead = resolve; }) });
    await ui.click("subtitle-import");
    assert.equal(ui.element("cancel").disabled, false);
    ui.lifecycle.hide();
    finishRead(srt("늦게 도착한 대사"));
    await ui.flush();
    ui.lifecycle.show();
    assert.equal(ui.element("library-count").textContent, "1");
    assert.equal(ui.element("cue-text").value, "유지할 대사");
    await ui.click("document-save");
    assert.equal(JSON.parse(ui.writes[0].text).revisions[0].transcript.segments[0].text, "유지할 대사");
  });

  it("keeps editing and saving locked across hide/show until a pending file write finishes", async () => {
    const ui = mount();
    await ui.importSrt("save.srt", srt("먼저 저장할 대사"));
    let finishWrite!: () => void;
    const originalPicker = ui.fs.getFileForSaving;
    ui.fs.getFileForSaving = async name => {
      const file = await originalPicker(name);
      return { ...file, async write(text: string) {
        await new Promise<void>(resolve => { finishWrite = resolve; });
        await file.write(text);
      } };
    };
    await ui.click("document-save");
    assert.equal(typeof finishWrite, "function");
    assert.equal(ui.writes.length, 0);
    try {
      ui.lifecycle.hide(); ui.lifecycle.show();
      assert.equal(ui.element("cue-save").disabled, true, "an unfinished save must keep editing locked");
      assert.equal(ui.element("document-save").disabled, true, "a second save must not overtake the pending write");
      assert.equal(ui.element("cancel").disabled, true, "a file write cannot be cancelled after it starts");
    } finally {
      finishWrite();
      await ui.flush();
    }
    assert.equal(ui.element("cue-save").disabled, false);
    assert.equal(ui.element("document-save").disabled, false);
    assert.match(ui.element("status").textContent, /저장 완료/);
    assert.equal(JSON.parse(ui.writes[0].text).revisions[0].transcript.segments[0].text, "먼저 저장할 대사");
    ui.fs.getFileForSaving = originalPicker;
    ui.element("cue-text").value = "나중에 저장할 대사";
    await ui.click("cue-save");
    await ui.click("document-save");
    assert.equal(ui.writes.length, 2);
    const latest = JSON.parse(ui.writes[1].text);
    assert.equal(latest.revisions.at(-1).transcript.segments[0].text, "나중에 저장할 대사");
  });
});
