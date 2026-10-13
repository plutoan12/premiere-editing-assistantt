import {describe,expect,it} from "vitest";
import {applySyncDryRun,type PremiereHost} from "./apply.js";
import type {PremiereSyncDryRun} from "./types.js";
const dry:PremiereSyncDryRun={sequenceName:"Sync",projectId:"p",projectVersion:"v1",warnings:[],errors:[],operations:[
 {kind:"place",clipId:"a",projectItemId:"ia",startSeconds:0,trackIndex:0,quantizationErrorSeconds:0},
 {kind:"place",clipId:"b",projectItemId:"ib",startSeconds:1,trackIndex:1,quantizationErrorSeconds:0}
]};
function host(overrides:Partial<PremiereHost>={}):PremiereHost {const current={projectId:"p",projectVersion:"v1",sequenceNames:[],media:[{clipId:"a",projectItemId:"ia"},{clipId:"b",projectItemId:"ib"}]};return {
 snapshot:async()=>current,createSyncSequence:async()=> "seq",placeClip:async()=>{},...overrides};}
describe("approved apply",()=>{
 it("rejects stale state before any mutation",async()=>{let mutated=false;const h=host({snapshot:async()=>({...await host().snapshot(),projectVersion:"v2"}),createSyncSequence:async()=>{mutated=true;return "x";}});await expect(applySyncDryRun(h,dry)).rejects.toThrow(/stale/i);expect(mutated).toBe(false);});
 it("creates dedicated sequence and applies operations in order",async()=>{const calls:string[]=[];const h=host({createSyncSequence:async n=>{calls.push("create:"+n);return "seq";},placeClip:async(_s,o)=>{calls.push(o.clipId);}});const r=await applySyncDryRun(h,dry);expect(calls).toEqual(["create:Sync","a","b"]);expect(r.applied).toEqual(["a","b"]);});
 it("reports partial failure without claiming rollback",async()=>{const h=host({placeClip:async(_s,o)=>{if(o.clipId==="b")throw new Error("host failed");}});const r=await applySyncDryRun(h,dry);expect(r.applied).toEqual(["a"]);expect(r.failed[0].clipId).toBe("b");expect(r.rolledBack).toBe(false);});
});
