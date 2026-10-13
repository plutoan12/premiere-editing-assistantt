import {afterEach,describe,expect,it} from "vitest";
import {mkdtemp,rm,writeFile,chmod} from "node:fs/promises";
import {tmpdir} from "node:os"; import {join} from "node:path";
import {runProcess} from "./process-runner.js";
import {probeMedia,HelperError} from "./ffmpeg.js";

const dirs:string[]=[]; afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function executable(body:string){const dir=await mkdtemp(join(tmpdir(),"pea ffmpeg 한글 "));dirs.push(dir);const file=join(dir,"fake ffprobe");await writeFile(file,"#!/usr/bin/env node\n"+body);await chmod(file,0o755);return file;}

describe("process ownership",()=>{
 it("passes paths and leading dashes as argv without shell parsing",async()=>{
   const exe=await executable('process.stdout.write(JSON.stringify(process.argv.slice(2)))');
   const args=["a b/한글.mov","--literal;$(echo nope)","-leading"];
   const out=await runProcess(exe,args,{timeoutMs:1000});
   expect(JSON.parse(out.stdout)).toEqual(args);
 });
 it("times out and reports TIMEOUT",async()=>{
   const exe=await executable('setTimeout(()=>{},5000)');
   await expect(runProcess(exe,[],{timeoutMs:20})).rejects.toMatchObject({code:"TIMEOUT"});
 });
 it("propagates abort as CANCELLED",async()=>{
   const exe=await executable('setTimeout(()=>{},5000)'); const c=new AbortController();
   const work=runProcess(exe,[],{timeoutMs:1000,signal:c.signal}); c.abort();
   await expect(work).rejects.toMatchObject({code:"CANCELLED"});
 });
 it("maps non-zero exit to PROCESS_FAILED with bounded diagnostics",async()=>{
   const exe=await executable('process.stderr.write("bad".repeat(10000));process.exit(7)');
   await expect(runProcess(exe,[],{timeoutMs:1000,maxOutputBytes:128})).rejects.toMatchObject({code:"PROCESS_FAILED"});
 });
});
describe("ffprobe normalization",()=>{
 it("returns normalized audio metadata",async()=>{
   const exe=await executable('process.stdout.write(JSON.stringify({format:{duration:"12.5"},streams:[{index:0,codec_type:"video",codec_name:"h264"},{index:1,codec_type:"audio",codec_name:"pcm_s16le",sample_rate:"48000",channels:2}]}))');
   const result=await probeMedia("/tmp/camera clip.mov",{ffprobePath:exe,timeoutMs:1000});
   expect(result.durationSeconds).toBe(12.5); expect(result.audio).toEqual({streamIndex:1,codec:"pcm_s16le",sampleRate:48000,channels:2});
 });
 it("rejects video-only media with NO_AUDIO",async()=>{
   const exe=await executable('process.stdout.write(JSON.stringify({format:{duration:"1"},streams:[{index:0,codec_type:"video",codec_name:"h264"}]}))');
   await expect(probeMedia("/tmp/video.mov",{ffprobePath:exe,timeoutMs:1000})).rejects.toMatchObject({code:"NO_AUDIO"});
 });
 it("rejects malformed probe JSON as CORRUPT_MEDIA",async()=>{
   const exe=await executable('process.stdout.write("not json")');
   await expect(probeMedia("/tmp/bad.mov",{ffprobePath:exe,timeoutMs:1000})).rejects.toMatchObject({code:"CORRUPT_MEDIA"});
 });
});
