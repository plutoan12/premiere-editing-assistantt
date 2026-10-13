import {describe,expect,it} from "vitest";
import {buildSyncDryRun} from "./sync-plan.js";
import {validateApplySnapshot} from "./state.js";
import type {SyncGroup} from "@pea/sync";
const group:SyncGroup={schemaVersion:"1.0.0",id:"g",referenceClipId:"a",strategy:"timecode",status:"matched",confidence:1,members:[{clipId:"a",mediaAssetId:"ma",offset:{ticks:0n,timebase:{numerator:1,denominator:24}},offsetTicks:0n}],candidates:[]};
const snap={projectId:"p",projectVersion:"v1",sequenceNames:[],media:[{clipId:"a",mediaAssetId:"ma",projectItemId:"ia"}]};
const dry=buildSyncDryRun(group,snap,{sequenceName:"Sync",frameRate:{numerator:24,denominator:1}});
describe("apply snapshot validation",()=>{
 it("accepts unchanged state",()=>expect(validateApplySnapshot(dry,snap).ok).toBe(true));
 it("rejects changed project/version",()=>expect(validateApplySnapshot(dry,{...snap,projectVersion:"v2"}).ok).toBe(false));
 it("rejects missing or replaced stable project item",()=>{
  expect(validateApplySnapshot(dry,{...snap,media:[]}).ok).toBe(false);
  expect(validateApplySnapshot(dry,{...snap,media:[{...snap.media[0],projectItemId:"other"}]}).ok).toBe(false);
 });
});
