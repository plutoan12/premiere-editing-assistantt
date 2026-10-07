import {describe,expect,it} from "vitest";
import {createPremiereUxpHost} from "./premiere-host.js";

function fixture(){
 const actions:unknown[]=[];const items=[{name:"A",getId:()=>"ia"},{name:"B",getId:()=>"ib"}];
 const sequences:Array<{guid:string;name:string}>=[];
 const project={guid:"project-1",path:"/test/project.prproj",getSequences:async()=>sequences,
  createSequence:async(name:string)=>{const s={guid:"seq-1",name};sequences.push(s);return s;},
  lockedAccess:(fn:()=>void)=>fn(),executeTransaction:(fn:(c:{addAction(a:unknown):void})=>void)=>{fn({addAction:a=>actions.push(a)});return true;}};
 const ppro={Project:{getActiveProject:async()=>project},ProjectUtils:{getSelection:async()=>({getItems:async()=>items})},
  SequenceEditor:{getEditor:()=>({createInsertProjectItemAction:(item:unknown,time:unknown,v:number,a:number,limit:boolean)=>({item,time,v,a,limit})})},
  TickTime:{createWithSeconds:(seconds:number)=>({seconds})}};
 return {ppro,project,items,sequences,actions};
}
describe("Premiere UXP host",()=>{
 it("snapshots active project, sequence names, and selected stable item IDs",async()=>{
  const f=fixture();const host=createPremiereUxpHost(f.ppro as never,[{clipId:"a",projectItemId:"ia"},{clipId:"b",projectItemId:"ib"}]);
  const s=await host.snapshot();expect(s.projectId).toBe("project-1");expect(s.media.map(x=>x.projectItemId)).toEqual(["ia","ib"]);
 });
 it("creates a dedicated empty sequence without pre-inserting media",async()=>{
  const f=fixture();const host=createPremiereUxpHost(f.ppro as never,[{clipId:"a",projectItemId:"ia"}]);
  expect(await host.createSyncSequence("PEA Sync")).toBe("seq-1");expect(f.sequences[0].name).toBe("PEA Sync");expect(f.actions).toHaveLength(0);
 });
 it("places a project item through SequenceEditor and executeTransaction",async()=>{
  const f=fixture();const host=createPremiereUxpHost(f.ppro as never,[{clipId:"a",projectItemId:"ia"}]);
  const id=await host.createSyncSequence("PEA Sync");
  await host.placeClip(id,{kind:"place",clipId:"a",projectItemId:"ia",startSeconds:1.25,trackIndex:2,quantizationErrorSeconds:0});
  expect(f.actions).toHaveLength(1);expect(f.actions[0]).toMatchObject({v:2,a:2,limit:false,time:{seconds:1.25}});
 });
 it("rejects unknown project item and failed Premiere transaction explicitly",async()=>{
  const f=fixture();const host=createPremiereUxpHost(f.ppro as never,[{clipId:"missing",projectItemId:"nope"}]);
  const id=await host.createSyncSequence("PEA Sync");
  await expect(host.placeClip(id,{kind:"place",clipId:"missing",projectItemId:"nope",startSeconds:0,trackIndex:0,quantizationErrorSeconds:0})).rejects.toThrow(/project item/i);
  f.project.executeTransaction=()=>false;
  const good=createPremiereUxpHost(f.ppro as never,[{clipId:"a",projectItemId:"ia"}]);
  await expect(good.placeClip(id,{kind:"place",clipId:"a",projectItemId:"ia",startSeconds:0,trackIndex:0,quantizationErrorSeconds:0})).rejects.toThrow(/transaction/i);
 });
});
