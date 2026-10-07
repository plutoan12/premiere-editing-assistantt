import type {PremiereHost,PremiereProjectSnapshot,PremiereSyncOperation} from "@pea/premiere-adapter";

export interface ClipBinding {clipId:string;mediaAssetId?:string;projectItemId:string}
interface ProjectItemLike {name:string;getId():string}
interface SequenceLike {guid:string;name:string}
interface ProjectLike {
 guid:string;path:string;
 getSequences():Promise<SequenceLike[]>;
 createSequence(name:string):Promise<SequenceLike>;
 getSequence?(guid:string):SequenceLike;
 lockedAccess(fn:()=>void):void;
 executeTransaction(fn:(compound:{addAction(action:unknown):void})=>void,undoString?:string):boolean;
}
export interface PremiereModuleLike {
 Project:{getActiveProject():Promise<ProjectLike>};
 ProjectUtils:{getSelection(project:ProjectLike):Promise<{getItems():Promise<ProjectItemLike[]>}>};
 SequenceEditor:{getEditor(sequence:SequenceLike):{createInsertProjectItemAction(item:ProjectItemLike,time:unknown,videoTrackIndex:number,audioTrackIndex:number,limitShift:boolean):unknown}};
 TickTime:{createWithSeconds(seconds:number):unknown};
}
function stateVersion(project:ProjectLike,sequences:SequenceLike[],items:ProjectItemLike[]):string {
 return JSON.stringify({projectId:String(project.guid),path:project.path,sequences:sequences.map(s=>[String(s.guid),s.name]).sort(),items:items.map(i=>i.getId()).sort()});
}
export function createPremiereUxpHost(ppro:PremiereModuleLike,bindings:readonly ClipBinding[]):PremiereHost {
 const itemCache=new Map<string,ProjectItemLike>(),sequenceCache=new Map<string,SequenceLike>();
 const active=async()=>ppro.Project.getActiveProject();
 const refresh=async()=>{const project=await active(),selection=await ppro.ProjectUtils.getSelection(project),items=await selection.getItems(),sequences=await project.getSequences();for(const item of items)itemCache.set(item.getId(),item);for(const sequence of sequences)sequenceCache.set(String(sequence.guid),sequence);return {project,items,sequences};};
 return {
  async snapshot():Promise<PremiereProjectSnapshot>{const {project,items,sequences}=await refresh(),ids=new Set(items.map(i=>i.getId()));return {projectId:String(project.guid),projectVersion:stateVersion(project,sequences,items),sequenceNames:sequences.map(s=>s.name),media:bindings.filter(b=>ids.has(b.projectItemId)).map(b=>({...b}))};},
  async createSyncSequence(name:string):Promise<string>{const project=await active(),existing=await project.getSequences();if(existing.some(s=>s.name===name))throw new Error(`sequence already exists: ${name}`);const sequence=await project.createSequence(name);const id=String(sequence.guid);sequenceCache.set(id,sequence);return id;},
  async placeClip(sequenceId:string,operation:PremiereSyncOperation):Promise<void>{const project=await active();let sequence=sequenceCache.get(sequenceId);if(!sequence&&project.getSequence)sequence=project.getSequence(sequenceId);if(!sequence)sequence=(await project.getSequences()).find(s=>String(s.guid)===sequenceId);if(!sequence)throw new Error(`Premiere sequence not found: ${sequenceId}`);let item=itemCache.get(operation.projectItemId);if(!item){const selection=await ppro.ProjectUtils.getSelection(project);for(const selected of await selection.getItems())itemCache.set(selected.getId(),selected);item=itemCache.get(operation.projectItemId);}if(!item)throw new Error(`Premiere project item not found: ${operation.projectItemId}`);const editor=ppro.SequenceEditor.getEditor(sequence),time=ppro.TickTime.createWithSeconds(operation.startSeconds),action=editor.createInsertProjectItemAction(item,time,operation.trackIndex,operation.trackIndex,false);let success=false;project.lockedAccess(()=>{success=project.executeTransaction(compound=>compound.addAction(action),`PEA Sync: place ${operation.clipId}`);});if(!success)throw new Error(`Premiere transaction failed for ${operation.clipId}`);}
 };
}
