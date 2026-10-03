import {afterAll,describe,expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";import {spawnSync} from "node:child_process";
import {createHelperServer} from "@pea/native-helper/server";import {syncClips} from "@pea/sync";import {createHelperAudioProvider} from "./index.js";
describe("generated real-container sync",()=>{
 let dir="";afterAll(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
 it("recovers a 250ms delayed take through ffmpeg -> HTTP -> sync engine",async()=>{
  dir=await mkdtemp(join(tmpdir(),"pea-real-media-"));const ref=join(dir,"ref.wav"),take=join(dir,"take.wav"),cache=join(dir,"cache");
  const a=spawnSync("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","anoisesrc=color=white:seed=123:d=4:r=8000","-c:a","pcm_f32le","-y",ref]);
  const b=spawnSync("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","anoisesrc=color=white:seed=123:d=3.5:r=8000","-af","adelay=250:all=1","-c:a","pcm_f32le","-y",take]);
  expect(a.status).toBe(0);expect(b.status).toBe(0);
  const s=await createHelperServer({cacheDir:cache});try{
   const provider=createHelperAudioProvider({baseUrl:`http://127.0.0.1:${s.port}`,token:s.token,paths:{ref,take},sampleRate:8000,startSeconds:0,durationSeconds:4});
   const group=await syncClips("real-file-fixture",[{clipId:"ref",hasAudio:true},{clipId:"take",hasAudio:true}],{audioProvider:provider,referenceClipId:"ref"});
   expect(group.status).toBe("matched");expect(group.members[1].offset.timebase).toEqual({numerator:1,denominator:8000});expect(Number(group.members[1].offset.ticks)).toBe(-2000);
  }finally{await s.close();}
 },20000);
});
