export type SyncStrategy="timecode"|"audio"|"manual";
export interface SyncEvidence{clipId:string;timecodeTicks?:bigint;audioFingerprint?:string}
export interface SyncMember{clipId:string;offsetTicks:bigint}
export interface SyncGroup{id:string;strategy:SyncStrategy;confidence:number;members:SyncMember[]}
export function chooseSyncStrategy(items:SyncEvidence[]):SyncStrategy{
 if(items.length>1&&items.every(x=>x.timecodeTicks!==undefined)) return "timecode";
 if(items.length>1&&items.every(x=>Boolean(x.audioFingerprint))) return "audio";
 return "manual";
}
export function buildTimecodeSyncGroup(id:string,items:SyncEvidence[]):SyncGroup{
 if(items.length<2||!items.every(x=>x.timecodeTicks!==undefined)) throw new Error("complete timecode evidence required");
 const earliest=items.reduce((m,x)=>x.timecodeTicks!<m?x.timecodeTicks!:m,items[0].timecodeTicks!);
 return {id,strategy:"timecode",confidence:1,members:items.map(x=>({clipId:x.clipId,offsetTicks:x.timecodeTicks!-earliest}))};
}
