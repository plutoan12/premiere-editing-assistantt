import {afterEach,describe,expect,it} from "vitest";
import {access,chmod,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os"; import {join} from "node:path";
import {decodeAudioWindow} from "./audio-window.js";
const dirs:string[]=[];afterEach(async()=>Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true}))));
async function exe(name:string,body:string){const d=await mkdtemp(join(tmpdir(),"pea audio "));dirs.push(d);const p=join(d,name);await writeFile(p,"#!/usr/bin/env node\n"+body);await chmod(p,0o755);return p;}
async function probe(){return exe("ffprobe",'process.stdout.write(JSON.stringify({format:{duration:"10"},streams:[{index:0,codec_type:"audio",codec_name:"pcm_s16le",sample_rate:"48000",channels:2}]}))');}
describe("bounded pcm extraction",()=>{
 it("rejects oversized windows before spawning ffmpeg",async()=>{
  const ff=await exe("ffmpeg",'require("node:fs").writeFileSync(process.env.MARKER,"spawned")');const marker=ff+".marker";
  await expect(decodeAudioWindow("/tmp/a.mov",{ffmpegPath:ff,ffprobePath:await probe(),cacheDir:join(tmpdir(),"pea-cache"),startSeconds:0,durationSeconds:100,sampleRate:48000,maxSamples:1000,env:{...process.env,MARKER:marker}})).rejects.toMatchObject({code:"WINDOW_TOO_LARGE"});
  await expect(access(marker)).rejects.toBeTruthy();
 });
 it("decodes mono float32le to a helper-owned artifact with exact metadata",async()=>{
  const ff=await exe("ffmpeg",`const fs=require("node:fs");const a=process.argv.slice(2);if(a[a.indexOf("-ac")+1]!=="1"||a[a.indexOf("-ar")+1]!=="8000"||a[a.indexOf("-f")+1]!=="f32le")process.exit(9);const b=Buffer.alloc(8);b.writeFloatLE(.25,0);b.writeFloatLE(-.5,4);fs.writeFileSync(a[a.length-1],b)`);
  const cache=await mkdtemp(join(tmpdir(),"pea cache "));dirs.push(cache);
  const r=await decodeAudioWindow("/tmp/camera.mov",{ffmpegPath:ff,ffprobePath:await probe(),cacheDir:cache,startSeconds:.5,durationSeconds:.01,sampleRate:8000,maxSamples:1000});
  expect(r.sampleRate).toBe(8000);expect(r.startSample).toBe(4000n);expect(r.sampleCount).toBe(2);expect(r.channelPolicy).toBe("mono-average");expect(r.path.startsWith(cache)).toBe(true);expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await readFile(r.path)).byteLength).toBe(8);
 });
 it("cleans partial output when ffmpeg fails",async()=>{
  const ff=await exe("ffmpeg",'const fs=require("node:fs");const p=process.argv.at(-1);fs.writeFileSync(p,"partial");process.exit(3)');
  const cache=await mkdtemp(join(tmpdir(),"pea cache "));dirs.push(cache);
  await expect(decodeAudioWindow("/tmp/camera.mov",{ffmpegPath:ff,ffprobePath:await probe(),cacheDir:cache,startSeconds:0,durationSeconds:.01,sampleRate:8000,maxSamples:1000})).rejects.toMatchObject({code:"PROCESS_FAILED"});
  expect((await import("node:fs/promises")).readdir(cache)).resolves.toEqual([]);
 });
});
