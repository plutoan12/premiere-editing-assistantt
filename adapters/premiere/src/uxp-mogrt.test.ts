import { describe, expect, it } from "vitest";
import * as host from "./index.js";

const request = () => ({ schemaVersion: "1.0.0", mode: "template-preview", decisionId: "caption-a",
  templateId: "title", templateVersion: "1", templatePath: "/templates/title.mogrt",
  startTicks: "508540032000", durationTicks: "254270016000", frameTicks: "8475667200",
  canvas: { width: 1920, height: 1080 } });
// UXP is only available inside Premiere. This fake models its synchronous locked transactions
// and async getters; the live panel smoke test separately checks Adobe's implementation.
function fixture() {
  const events: string[] = []; let start = "0", end = "0", frameTicks = "0";
  let rect = {width:0,height:0}; let inserted = false;
  const tick = (ticks: string) => ({ticks});
  const item = { getStartTime: async () => tick(start), getEndTime: async () => tick(end),
    createSetEndAction: (time: {ticks:string}) => () => { end = time.ticks; },
    getName: async () => "Template", getComponentChain: async () => ({getComponentCount:()=>0}) };
  const sequence = { guid:{toString:()=>"new-sequence"}, name:"preview", getSettings:async()=>({
    setVideoFrameRate:(r:{ticksPerFrame:number})=>{frameTicks=String(r.ticksPerFrame);return true;},
    setVideoFrameRect:async(r:{width:number;height:number})=>{rect=r;return true;},
  }), createSetSettingsAction:()=>()=>{events.push("settings");},
  getTimebase:async()=>frameTicks, getFrameSize:async()=>rect,
  getVideoTrack:async()=>({getTrackItems:()=>inserted?[item]:[]}),
  getAudioTrack:async()=>({getTrackItems:():typeof item[]=>[]}), };
  const project = {guid:{toString:()=>"project"},createSequence:async()=>{events.push("create");return sequence;},
    lockedAccess:(f:()=>void)=>{events.push("lock");f();},
    executeTransaction:(f:(c:{addAction:(a:()=>void)=>void})=>void)=>{const actions:(()=>void)[]=[];f({addAction:a=>actions.push(a)});actions.forEach(a=>a());return true;},
    openSequence:async()=>true,
  };
  const ppro = {Project:{getActiveProject:async()=>project},
    TickTime:{createWithTicks:tick,createWithSeconds:()=>tick("254016000000")},
    FrameRate:class {ticksPerFrame=0;}, RectF:class {width=0;height=0;},
    Constants:{TrackItemType:{CLIP:1,TRANSITION:2}},
    SequenceEditor:{getEditor:()=>({insertMogrtFromPath:(path:string,time:{ticks:string},v:number,a:number)=>{
      events.push(`insert:${path}:${time.ticks}:${v}:${a}`);start=time.ticks;end=String(BigInt(start)+508540032000n);inserted=true;return [item];
    }})},
  };
  return {ppro,project,sequence,item,events};
}

describe("UXP MOGRT preview",()=>{
  it("inserts into a new sequence and verifies exact NTSC start/end ticks",async()=>{
    const f=fixture();const result=await host.previewPremiereMogrt(f.ppro,request(),"project");
    expect(result).toMatchObject({status:"preview-created",sequenceId:"new-sequence",graphicsApplied:false,
      items:[{startTicks:"508540032000",endTicks:"762810048000"}]});
    expect(f.events).toContain("insert:/templates/title.mogrt:508540032000:0:0");
    expect(f.events.indexOf("settings")).toBeLessThan(f.events.findIndex(e=>e.startsWith("insert:")));
  });
  it.each([
    {mode:"apply"}, {startTicks:"01"}, {startTicks:"-1"}, {durationTicks:"0"},
    {startTicks:"1"}, {durationTicks:"1"}, {startTicks:"9223372036854775808"},
    {frameTicks:"9007199254740992"}, {templatePath:"../title.mogrt"}, {templatePath:"https://host/title.mogrt"},
    {canvas:{width:0,height:1080}}, {properties:[{id:"Text",value:"ignored"}]},
  ])("rejects malformed or non-preview requests before creating a sequence: %j",async patch=>{
    const f=fixture();await expect(host.previewPremiereMogrt(f.ppro,{...request(),...patch},"project")).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
  it("blocks a project changed since preview review",async()=>{
    const f=fixture();await expect(host.previewPremiereMogrt(f.ppro,request(),"old-project")).rejects.toThrow(/PROJECT_CHANGED/);
    expect(f.events).toEqual([]);
  });
  it("retains an actionable sequence receipt on a false settings transaction",async()=>{
    const f=fixture();f.project.executeTransaction=()=>false;
    expect(await host.previewPremiereMogrt(f.ppro,request(),"project")).toMatchObject({status:"needs-review",sequenceId:"new-sequence",code:"SETTINGS_FAILED"});
    expect(f.events.some(e=>e.startsWith("insert:"))).toBe(false);
  });
  it("refuses to insert if the newly created sequence becomes occupied",async()=>{
    const f=fixture();f.sequence.getAudioTrack=async()=>({getTrackItems:()=>[f.item]});
    expect(await host.previewPremiereMogrt(f.ppro,request(),"project")).toMatchObject({status:"needs-review",code:"SEQUENCE_NOT_EMPTY"});
    expect(f.events.some(e=>e.startsWith("insert:"))).toBe(false);
  });
  it("does not retry or claim success when insertion throws after an unknown host change",async()=>{
    const f=fixture();f.ppro.SequenceEditor.getEditor=()=>({insertMogrtFromPath:()=>{f.events.push("insert-attempt");throw Error("private path");}});
    expect(await host.previewPremiereMogrt(f.ppro,request(),"project")).toMatchObject({status:"needs-review",code:"INSERT_FAILED",sequenceId:"new-sequence"});
    expect(f.events.filter(e=>e==="insert-attempt")).toHaveLength(1);
  });
  it("detects a host that ignores the requested trim",async()=>{
    const f=fixture();f.item.createSetEndAction=()=>()=>{};
    expect(await host.previewPremiereMogrt(f.ppro,request(),"project")).toMatchObject({status:"needs-review",code:"RANGE_MISMATCH"});
  });
  it("keeps a busy host from creating duplicate previews",async()=>{
    const f=fixture();let finish:((p:typeof f.project)=>void)|undefined;
    f.ppro.Project.getActiveProject=()=>new Promise(resolve=>{finish=resolve;});
    const first=host.previewPremiereMogrt(f.ppro,request(),"project");
    await expect(host.previewPremiereMogrt(f.ppro,request(),"project")).rejects.toThrow(/PREVIEW_BUSY/);
    finish!(f.project);await first;
  });
});
