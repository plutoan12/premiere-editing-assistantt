import {afterEach,describe,expect,it} from "vitest";
import {chmod,mkdtemp,rm,writeFile} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
import {createHelperServer} from "@pea/native-helper/server";
import {createHelperAudioProvider} from "./index.js";
const dirs:string[]=[];const servers:Array<{close():Promise<void>}>=[];afterEach(async()=>{while(servers.length)await servers.pop()!.close();await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function exe(name:string,body:string){const d=await mkdtemp(join(tmpdir(),"pea client "));dirs.push(d);const p=join(d,name);await writeFile(p,"#!/usr/bin/env node\n"+body);await chmod(p,0o755);return p;}
describe("helper AudioSampleProvider",()=>{
 it("decodes authenticated binary float32 metadata into canonical samples",async()=>{
  const probe=await exe("ffprobe",'process.stdout.write(JSON.stringify({format:{duration:"5"},streams:[{index:0,codec_type:"audio",codec_name:"pcm_s16le",sample_rate:"48000",channels:2}]}))');
  const ff=await exe("ffmpeg",'const fs=require("node:fs");const a=process.argv.slice(2),b=Buffer.alloc(12);b.writeFloatLE(.25,0);b.writeFloatLE(-.5,4);b.writeFloatLE(.75,8);fs.writeFileSync(a.at(-1),b)');
  const cache=await mkdtemp(join(tmpdir(),"pea helper cache "));dirs.push(cache);
  const s=await createHelperServer({ffmpegPath:ff,ffprobePath:probe,cacheDir:cache});servers.push(s);
  const p=createHelperAudioProvider({baseUrl:`http://127.0.0.1:${s.port}`,token:s.token,paths:{cam:"/tmp/camera.mov"},sampleRate:8000,startSeconds:.5,durationSeconds:.01});
  const w=await p.read({clipId:"cam",hasAudio:true});
  expect(w.sampleRate).toBe(8000);expect(w.startSample).toBe(4000n);expect([...w.samples]).toEqual([.25,-.5,.75]);
 });
 it("does not send media requests with a wrong token",async()=>{
  const s=await createHelperServer();servers.push(s);
  const p=createHelperAudioProvider({baseUrl:`http://127.0.0.1:${s.port}`,token:"wrong",paths:{cam:"/tmp/x.mov"},sampleRate:8000,startSeconds:0,durationSeconds:.01});
  await expect(p.read({clipId:"cam",hasAudio:true})).rejects.toMatchObject({code:"UNAUTHORIZED"});
 });
});
