import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, chmod, readdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const subject = await import("./index.js").catch(() => ({})) as typeof import("./index.js");
const json = JSON.stringify({ result: { language: "ko" }, transcription: [{ offsets: { from: 1250, to: 2750 }, text: " 안녕하세요." }] });
async function fixture(run: (f: { root: string; media: string; model: string; ffmpeg: string; whisper: string; scratch: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "pea-native-test-"));
  const media = join(root, "clip ; not-a-command.wav"), model = join(root, "model.bin"), ffmpeg = join(root, "fake-ffmpeg"), whisper = join(root, "fake-whisper"), scratch = join(root, "scratch");
  const { mkdir } = await import("node:fs/promises"); await mkdir(scratch);
  await writeFile(media, "original"); await writeFile(model, "fixture-model-not-real-weights");
  const executable = async (path: string, code: string) => { await writeFile(path, `#!${process.execPath}\n${code}\n`); await chmod(path, 0o700); };
  await executable(ffmpeg, `const fs=require('node:fs');const a=process.argv.slice(2);if(!a.includes('-nostdin')||!a.includes('file,pipe')||a[a.indexOf('-ar')+1]!=='16000'||a[a.indexOf('-ac')+1]!=='1')process.exit(8);fs.writeFileSync(a.at(-1),'converted');`);
  await executable(whisper, `const fs=require('node:fs');const a=process.argv.slice(2);if(!a.includes('-oj')||a.includes('-tr'))process.exit(9);fs.writeFileSync(a[a.indexOf('-of')+1]+'.json',${JSON.stringify(json)});`);
  try { await run({ root, media, model, ffmpeg, whisper, scratch }); } finally { await rm(root, { recursive: true, force: true }); }
}

describe("whisper.cpp JSON", () => {
  it("uses CLI offsets as milliseconds, not seconds or ticks x10 again", () => {
    const t = subject.parseWhisperCppJSON(json, "m");
    assert.equal(t.segments[0].range.start.ticks, 1250n); assert.equal(t.segments[0].range.duration.ticks, 1500n);
    assert.equal(t.segments[0].text, " 안녕하세요."); assert.equal(t.segments[0].speakerId, undefined);
  });
  it("preserves silence as an empty transcript", () => assert.equal(subject.parseWhisperCppJSON('{"transcription":[]}', "m").segments.length, 0));
  for (const from of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1250"]) {
    it(`rejects unsafe offset ${from}`, () => assert.throws(() => subject.parseWhisperCppJSON(JSON.stringify({ transcription: [{ offsets: { from, to: 3000 }, text: "x" }] }), "m")));
  }
});

describe("bounded native processes", () => {
  it("passes metacharacters as literal arguments with no shell", async () => {
    const result = await subject.runNativeProcess(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "a;$(echo bad) 한글"], { timeoutMs: 5000 });
    assert.equal(result.stdout, "a;$(echo bad) 한글");
  });
  it("reports nonzero process exit", async () => {
    await assert.rejects(subject.runNativeProcess(process.execPath, ["-e", "process.exit(17)"], { timeoutMs: 5000 }), { name: "NativeProcessError" });
  });
  it("terminates a process on timeout", async () => {
    await assert.rejects(subject.runNativeProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 50 }), { name: "TimeoutError" });
  });
  it("kills and awaits a process when cancelled", async () => {
    const controller = new AbortController();
    const result = subject.runNativeProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 5000, signal: controller.signal });
    controller.abort(); await assert.rejects(result, { name: "AbortError" });
  });
  it("caps combined stdout and stderr bytes", async () => {
    await assert.rejects(subject.runNativeProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], { timeoutMs: 5000, maxOutputBytes: 128 }), { name: "OutputLimitError" });
  });
});

describe("local transcription pipeline", () => {
  it("runs both executables, parses their result, preserves source and removes only its temp directory", () => fixture(async f => {
    const provider = subject.createWhisperCppProvider({ ffmpegPath: f.ffmpeg, whisperPath: f.whisper, modelPath: f.model, tempRoot: f.scratch });
    const t = await provider.transcribe({ mediaAssetId: "m", mediaPath: f.media });
    assert.equal(t.segments[0].range.start.ticks, 1250n); assert.equal(await readFile(f.media, "utf8"), "original");
    assert.deepEqual(await readdir(f.scratch), []);
  }));
  it("rejects remote media instead of downloading it", () => fixture(async f => {
    const p = subject.createWhisperCppProvider({ ffmpegPath: f.ffmpeg, whisperPath: f.whisper, modelPath: f.model, tempRoot: f.scratch });
    await assert.rejects(p.transcribe({ mediaAssetId: "m", mediaPath: "https://example.invalid/video.mp4" }), /absolute|local/i);
    assert.deepEqual(await readdir(f.scratch), []);
  }));
  it("cleans temporary files after a CLI failure", () => fixture(async f => {
    await writeFile(f.whisper, `#!${process.execPath}\nprocess.exit(47)\n`);
    const p = subject.createWhisperCppProvider({ ffmpegPath: f.ffmpeg, whisperPath: f.whisper, modelPath: f.model, tempRoot: f.scratch });
    await assert.rejects(p.transcribe({ mediaAssetId: "m", mediaPath: f.media }), { name: "NativeProcessError" });
    assert.deepEqual(await readdir(f.scratch), []); assert.equal(await readFile(f.media,"utf8"), "original");
  }));
  it("does not create temporary files for a cancelled request", () => fixture(async f => {
    const controller = new AbortController(); controller.abort();
    const p = subject.createWhisperCppProvider({ ffmpegPath: f.ffmpeg, whisperPath: f.whisper, modelPath: f.model, tempRoot: f.scratch });
    await assert.rejects(p.transcribe({ mediaAssetId: "m", mediaPath: f.media, signal: controller.signal }), { name: "AbortError" });
    assert.deepEqual(await readdir(f.scratch), []);
  }));
  it("caps result JSON before loading it", () => fixture(async f => {
    const p = subject.createWhisperCppProvider({ ffmpegPath: f.ffmpeg, whisperPath: f.whisper, modelPath: f.model, tempRoot: f.scratch, maxJSONBytes: 8 });
    await assert.rejects(p.transcribe({ mediaAssetId: "m", mediaPath: f.media }), /JSON|size/i);
    assert.deepEqual(await readdir(f.scratch), []);
  }));
  it("decodes a real WAV through installed FFmpeg; recognition remains an explicit CLI fixture", async ctx => {
    const ffmpeg = process.env.PEA_TEST_FFMPEG;
    if (!ffmpeg) { ctx.skip(); return; }
    await access(ffmpeg);
    await fixture(async f => {
      const samples = 4800, wav = Buffer.alloc(44 + samples * 2);
      wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ",8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(48000,24); wav.writeUInt32LE(96000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write("data",36); wav.writeUInt32LE(samples * 2,40);
      for(let i=0;i<samples;i++) wav.writeInt16LE(Math.round(Math.sin(i*0.1)*1000),44+i*2);
      await writeFile(f.media,wav);
      await writeFile(f.whisper, `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);const w=fs.readFileSync(a[a.indexOf('-f')+1]);const p=w.indexOf(Buffer.from('fmt '));if(p<0||w.readUInt16LE(p+10)!==1||w.readUInt32LE(p+12)!==16000)process.exit(25);fs.writeFileSync(a[a.indexOf('-of')+1]+'.json',${JSON.stringify(json)});\n`);
      const p = subject.createWhisperCppProvider({ ffmpegPath: ffmpeg, whisperPath: f.whisper, modelPath: f.model, tempRoot: f.scratch });
      assert.equal((await p.transcribe({ mediaAssetId: "m", mediaPath: f.media })).segments.length,1);
      assert.deepEqual(await readFile(f.media),wav); assert.deepEqual(await readdir(f.scratch),[]);
    });
  });
});
