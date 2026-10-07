import { beforeAll, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createSubtitleDocument, serializeSubtitleDocument } from "@pea/transcript";

let bundle: string, html: string;
beforeAll(async () => {
  bundle = (await build({ entryPoints: [fileURLToPath(new URL("./ui.ts", import.meta.url))], bundle: true,
    write: false, platform: "browser", format: "iife", target: "chrome99" })).outputFiles[0].text;
  html = await readFile(new URL("../index.html", import.meta.url), "utf8");
});

class Element {
  textContent = ""; disabled = false; files: Array<{ content: string; name: string; size: number; fail?: boolean }> = [];
  listeners = new Map<string, () => void>();
  addEventListener(event: string, callback: () => void) { this.listeners.set(event, callback); }
  emit(event: string) { if (!this.disabled) this.listeners.get(event)?.(); }
  set innerHTML(_: string) { throw new Error("unsafe HTML rendering"); }
}
const target = { available: true, projectPath: "/projects/edit.prproj", sequenceId: "sequence-1", sequenceName: "편집본" };
function documentJSON(kind: "source" | "sequence" = "sequence", text = "<b>안녕하세요</b>") {
  const time = (ticks: bigint) => ({ ticks, timebase: { numerator: 1, denominator: 1000 } });
  return serializeSubtitleDocument(createSubtitleDocument({
    id: "doc-1", origin: { kind, mediaAssetId: "render-1", label: "최종 편집본", inputRevision: "input-1",
      ...(kind === "sequence" ? { timelineStart: time(5500n) } : {}) }, source: "srt",
    transcript: { id: "transcript-1", segments: [{ id: "cue-1", mediaAssetId: "render-1", text,
      range: { start: time(1000n), duration: time(2000n) } }] }
  }));
}

/** Real browser bundle and document preparation; only CEP, file picker and DOM boundaries are faked. */
function mount(storage = new Map<string, string>(), canHash = true) {
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(); element.disabled = match[0].includes(" disabled"); elements.set(match[1], element);
  }
  const el = (id: string) => { const element = elements.get(id); assert.ok(element, id); return element; };
  const files = new Map<string, string>(), calls: Array<Record<string, unknown>> = [];
  let currentTarget = { ...target }, writeError = 0, dropApply = false, reply: unknown;
  const timers = new Map<number, () => void>(); let nextTimer = 0;
  const fs = {
    ERR_NOT_FOUND: 3,
    stat(path: string) { return path.endsWith("/PeaCaptionBridge")
      ? { err: 0, data: { isDirectory: () => true } } : { err: files.has(path) ? 0 : 3 }; },
    makedir() { return { err: 0 }; },
    writeFile(path: string, content: string, encoding: string) {
      assert.equal(encoding, "UTF-8"); if (!writeError) files.set(path, content); return { err: writeError };
    },
    readFile(path: string, encoding: string) { assert.equal(encoding, "UTF-8"); return { err: 0, data: files.get(path) }; }
  };
  const host = { PeaCaptionBridge: {
    inspect() { return JSON.stringify(currentTarget); },
    apply(json: string) { const request = JSON.parse(json); calls.push(request);
      return JSON.stringify(reply ?? { status: "applied", requestId: request.requestId, cueCount: request.cueCount, code: "APPLIED", message: "created" }); }
  } };
  class CSInterface {
    getSystemPath() { return "/Users/editor/Library/Application Support/Adobe"; }
    evalScript(script: string, callback: (response: string) => void) {
      const response = vm.runInNewContext(script, host);
      if (!(dropApply && script.includes(".apply("))) queueMicrotask(() => callback(response));
    }
  }
  class Reader {
    result: string | null = null; onload?: () => void; onerror?: () => void;
    readAsText(file: { content: string; fail?: boolean }) { queueMicrotask(() => {
      if (file.fail) this.onerror?.(); else { this.result = file.content; this.onload?.(); }
    }); }
  }
  const context = vm.createContext({ console, TextEncoder,
    crypto: canHash ? webcrypto : { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, CSInterface, SystemPath: { USER_DATA: "userData" },
    FileReader: Reader, window: { cep: { fs, encoding: { UTF8: "UTF-8" } } },
    document: { getElementById: (id: string) => elements.get(id) },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id)
  });
  vm.runInContext(bundle, context);
  const finished = () => !el("document-file").disabled || /적용 결과를 확인하지 못했습니다/.test(el("status").textContent);
  const click = async (id: string) => {
    const previousCalls = calls.length;
    el(id).emit("click");
    await vi.waitFor(() => assert.ok(dropApply ? calls.length > previousCalls : finished()), { timeout: 3000, interval: 5 });
  };
  const open = async (json = documentJSON(), fail = false) => {
    el("document-file").files = [{ content: json, name: "edit.subtitle.json", size: Buffer.byteLength(json), fail }];
    el("document-file").emit("change");
    await vi.waitFor(() => assert.equal(el("document-file").disabled, false), { timeout: 3000, interval: 5 });
  };
  return { el, files, calls, storage, open, click,
    switchTarget: () => { currentTarget = { ...target, sequenceId: "sequence-2", sequenceName: "다른 편집본" }; },
    failWrite: () => { writeError = 6; }, dropApply: () => { dropApply = true; },
    reply: (value: unknown) => { reply = value; },
    timeout: async () => {
      for (const fn of [...timers.values()]) fn();
      await vi.waitFor(() => assert.match(el("status").textContent, /적용 결과를 확인하지 못했습니다/), { timeout: 3000, interval: 5 });
    }
  };
}

describe("caption companion browser UI", () => {
  it("previews the pinned target and writes offset SRT before exactly one native apply", async () => {
    const ui = mount(); await ui.open();
    assert.match(ui.el("target-summary").textContent, /편집본/);
    assert.match(ui.el("document-summary").textContent, /1/);
    assert.equal(ui.el("caption-apply").disabled, false);
    await ui.click("caption-apply");
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].expectedSequenceId, "sequence-1");
    assert.equal(ui.calls[0].expectedProjectPath, "/projects/edit.prproj");
    const [path, srt] = [...ui.files][0];
    assert.match(path, /\/PeaCaptionBridge\/caption-[A-Za-z0-9-]+\.srt$/);
    assert.equal(srt, "1\n00:00:06,500 --> 00:00:08,500\n<b>안녕하세요</b>\n");
    assert.match(ui.el("status").textContent, /새 캡션 트랙/);
    assert.equal(ui.el("caption-apply").disabled, true);
    await ui.click("caption-apply"); assert.equal(ui.calls.length, 1);
    const reopened = mount(ui.storage); await reopened.open();
    assert.equal(reopened.el("caption-apply").disabled, true);
    assert.match(reopened.el("status").textContent, /이미|이력/);
  });

  it("rejects source documents and read errors before any native change", async () => {
    const ui = mount(); await ui.open(documentJSON("source"));
    assert.equal(ui.el("caption-apply").disabled, true);
    assert.match(ui.el("status").textContent, /편집본/);
    await ui.open(documentJSON(), true);
    assert.match(ui.el("status").textContent, /읽/);
    assert.equal(ui.el("caption-apply").disabled, true);
    assert.equal(ui.calls.length, 0); assert.equal(ui.files.size, 0);
  });

  it("rejects changed targets and failed artifact writes without dispatching an apply", async () => {
    const changed = mount(); await changed.open(); changed.switchTarget(); await changed.click("caption-apply");
    assert.match(changed.el("status").textContent, /대상|시퀀스/);
    assert.equal(changed.calls.length, 0); assert.equal(changed.files.size, 0);
    const unwritable = mount(); await unwritable.open(); unwritable.failWrite(); await unwritable.click("caption-apply");
    assert.match(unwritable.el("status").textContent, /저장/);
    assert.equal(unwritable.calls.length, 0);
  });

  it("persists an uncertain dispatch and never retries on timeout or mismatched response", async () => {
    const ui = mount(); await ui.open(); ui.dropApply(); await ui.click("caption-apply");
    assert.equal(ui.el("document-file").disabled, true);
    await ui.timeout();
    assert.match(ui.el("status").textContent, /확인하지 못|확인할 수 없/);
    assert.equal(ui.el("caption-apply").disabled, true); assert.equal(ui.calls.length, 1);
    const reopened = mount(ui.storage); await reopened.open(); assert.equal(reopened.el("caption-apply").disabled, true);
    const malformed = mount(); await malformed.open(); malformed.reply({ status: "applied", requestId: "wrong" });
    await malformed.click("caption-apply");
    assert.match(malformed.el("status").textContent, /확인하지 못|확인할 수 없/);
    assert.equal(malformed.el("caption-apply").disabled, true);
  });

  it("allows different content forked from the same revision but blocks repeated identical content", async () => {
    const ui = mount(); await ui.open(); await ui.click("caption-apply");
    await ui.open(documentJSON("sequence", "다른 분기에서 고친 대사"));
    assert.equal(ui.el("caption-apply").disabled, false);
    await ui.click("caption-apply");
    assert.equal(ui.calls.length, 2);
    assert.match([...ui.files.values()][1], /다른 분기에서 고친 대사/);
    await ui.open(documentJSON("sequence", "다른 분기에서 고친 대사"));
    assert.equal(ui.el("caption-apply").disabled, true);
  });

  it("does not allow an apply when the browser cannot fingerprint subtitle content", async () => {
    const ui = mount(new Map(), false); await ui.open();
    assert.equal(ui.el("caption-apply").disabled, true);
    assert.match(ui.el("status").textContent, /내용|해시/);
    assert.equal(ui.calls.length, 0); assert.equal(ui.files.size, 0);
  });
});
