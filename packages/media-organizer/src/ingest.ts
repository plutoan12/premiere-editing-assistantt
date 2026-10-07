import {z} from 'zod';
import {canTransitionJob,promoteArtifact,validateBoundedTimeRange,encodeMediaTime,type Job,type ProviderContext,type MediaProbeProvider} from '@pea/core';
import {type CatalogState,type CatalogStore,type IdFactory} from './catalog.js';
import {type ScanInput,type ReadOnlyFiles,type IngestResult,type IngestItemResult,ScanInputSchema,ProbeRecordSchema,FileStampSchema,sameStamp} from './scan.js';
import {type MetadataField} from './metadata.js';
export interface IngestDependencies {store:CatalogStore;files:ReadOnlyFiles;probe:MediaProbeProvider;ids:IdFactory;providerVersion:string;settingsKey:string}
export interface IngestContext extends ProviderContext {retryJobId?:string}
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
const makeId=(ids:IdFactory)=>z.uuid().parse(ids());
const moveJob=(job:Job,status:Job['status']):Job=>{
  if(!canTransitionJob(job.status,status)) throw new Error(`invalid job transition ${job.status} to ${status}`);
  return {...job,status};
};
const requestKey=(input:ScanInput)=>JSON.stringify([input.uri,input.existingAssetId,input.sourceRange&&[encodeMediaTime(input.sourceRange.start),encodeMediaTime(input.sourceRange.duration)]]);
class ItemFailure extends Error {constructor(public state:IngestItemResult['state'],message:string){super(message);}}
const checkAbort=(ctx?:ProviderContext)=>{if(ctx?.signal?.aborted)throw new ItemFailure('cancelled','cancelled');};

/** Each result is committed with its asset before reporting success. */
export async function ingest(rawInputs:ScanInput[],deps:IngestDependencies,ctx?:IngestContext):Promise<IngestResult>{
  const inputs=rawInputs.map(x=>ScanInputSchema.parse(x));
  if(new Set(inputs.map(x=>x.scanId)).size!==inputs.length)throw new Error('duplicate scan identity');
  let state=await deps.store.read();
  for(const input of inputs){
    const prior=state.scans.find(x=>x.scanId===input.scanId);
    if(prior && requestKey(prior)!==requestKey(input))throw new Error('scan identity cannot be reused for different input');
    if(input.existingAssetId && !state.assets.some(x=>x.asset.id===input.existingAssetId&&x.locations.includes(input.uri)))throw new Error('existing asset or location not found');
  }
  let job:Job;
  if(ctx?.retryJobId){
    const previous=state.jobs.find(x=>x.job.id===ctx.retryJobId);
    if(!previous || previous.job.status!=='failed')throw new Error('only a failed job can be retried by ID');
    job={...moveJob(previous.job,'queued'),attempt:previous.job.attempt+1,error:undefined};
  }else job={id:makeId(deps.ids),kind:'media-ingest',status:'queued',attempt:0};
  const items:IngestItemResult[]=[];
  const putJob=(s:CatalogState)=>{
    const index=s.jobs.findIndex(x=>x.job.id===job.id),row={job:{...job},items:[...items]};
    if(index<0)s.jobs.push(row);else s.jobs[index]=row;
  };
  putJob(state);state=await deps.store.commit(state.revision,state);
  job=moveJob(job,'running');putJob(state);await deps.store.commit(state.revision,state);
  const seen=new Map<string,IngestItemResult>();
  try{
    for(const input of inputs){
      state=await deps.store.read();
      const prior=state.scans.find(x=>x.scanId===input.scanId);
      let result:IngestItemResult;
      const scan={...input,state:'running' as const,step:'reading' as const,providerVersion:deps.providerVersion,settingsKey:deps.settingsKey};
      if(!prior)state.scans.push(scan);
      else state.scans[state.scans.indexOf(prior)]={...prior,...scan};
      state=await deps.store.commit(state.revision,state);
      const working=state.scans.find(x=>x.scanId===input.scanId)!;
      try{
        checkAbort(ctx);
        const before=FileStampSchema.parse(await deps.files.stat(input.uri));
        const cachedAsset=prior?.result?.assetId && state.assets.find(x=>x.asset.id===prior.result?.assetId);
        const duplicate=seen.get(requestKey(input));
        if(duplicate?.assetId){
          result={...duplicate,scanId:input.scanId,state:'unchanged'};
        }else if(prior?.stamp && cachedAsset && prior.providerVersion===deps.providerVersion && prior.settingsKey===deps.settingsKey
          && sameStamp(before,prior.stamp) && ['registered','unchanged'].includes(prior.state)){
          result={...prior.result!,state:'unchanged'};
        }else{
          const hash=z.string().regex(/^[0-9a-fA-F]{64}$/).parse(await deps.files.sha256(input.uri,ctx)).toLowerCase();
          checkAbort(ctx);
          const probe=ProbeRecordSchema.parse(await deps.probe.probe({uri:input.uri},ctx));
          checkAbort(ctx);
          const after=FileStampSchema.parse(await deps.files.stat(input.uri));
          if(!sameStamp(before,after))throw new ItemFailure('changed_during_read','file changed during analysis');
          checkAbort(ctx);
          const existingId=input.existingAssetId || (cachedAsset?cachedAsset.asset.id:undefined);
          const old=state.assets.find(x=>x.asset.id===existingId);
          const changed=old && old.asset.fingerprint.value.toLowerCase()!==hash;
          const assetId=old?.asset.id??makeId(deps.ids);
          const revision=(old?.fileRevision??1)+(changed?1:0);
          const artifact=promoteArtifact({id:makeId(deps.ids),kind:'media-probe',version:revision,status:'valid'},old?.analysis?.artifact)!;
          const record={asset:{id:assetId,uri:old?.asset.uri??input.uri,fingerprint:{algorithm:'sha256' as const,value:hash},readOnly:true as const,frameRate:probe.frameRate},
            fileRevision:revision,locations:old?.locations??[input.uri],duration:probe.duration,availability:'online' as const,probe,
            analysis:{artifact,providerVersion:deps.providerVersion,settingsKey:deps.settingsKey}};
          const range=input.sourceRange??(probe.duration?{start:{...probe.duration,ticks:0n},duration:probe.duration}:undefined);
          if(input.sourceRange&&!probe.duration)throw new ItemFailure('unsupported','source duration is unavailable');
          if(range&&probe.duration)validateBoundedTimeRange(range,probe.duration);
          let clipId=prior?.result?.clipId;
          if(old){
            state.assets[state.assets.indexOf(old)]=record;
            if(changed)for(const c of state.clips.filter(x=>x.mediaAssetId===assetId)){
              const cs=state.clipStates.find(x=>x.clipId===c.id);
              if(cs)cs.reviewState='needs_review';else state.clipStates.push({clipId:c.id,fileRevision:old.fileRevision,reviewState:'needs_review'});
            }
          }else state.assets.push(record);
          if(!old&&range){
            clipId=makeId(deps.ids);state.clips.push({id:clipId,mediaAssetId:assetId,sourceRange:range});
            state.clipStates.push({clipId,fileRevision:revision,reviewState:'confirmed'});
          }
          // Keep host/user candidates; refresh only observations owned by this probe.
          const candidates=[...probe.candidates,{field:'mediaKind' as const,value:probe.mediaKind,source:'probe' as const,provenance:{provider:'media-probe',version:deps.providerVersion}}];
          const fields:MetadataField[]=['captureDate','deviceId','scene','take','mediaKind'];
          for(const field of fields){
            let row=state.metadata.find(x=>x.target.kind==='asset'&&x.target.id===assetId&&x.field===field);
            const observations=candidates.filter(x=>x.field===field);
            if(!row){row={target:{kind:'asset',id:assetId},field,candidates:[]};state.metadata.push(row);}
            row.candidates=[...row.candidates.filter(x=>x.source!=='probe'),...observations];
          }
          result={scanId:input.scanId,state:old?'unchanged':'registered',assetId,clipId};
          working.stamp=after;
        }
        working.stamp??=before;
      }catch(error){
        // Roll back tentative in-memory asset/probe changes on any item error.
        state=await deps.store.read();
        const code=(error as {code?:string})?.code;
        const status=error instanceof ItemFailure?error.state:code==='ENOENT'?'offline':'failed';
        result={scanId:input.scanId,state:status,error:{code:code??status,message:message(error)}};
        if(status==='offline'){
          const existing=input.existingAssetId??prior?.result?.assetId;
          const asset=state.assets.find(x=>x.asset.id===existing);if(asset)asset.availability='offline';
        }
      }
      const finalScan=state.scans.find(x=>x.scanId===input.scanId)!;
      Object.assign(finalScan,{state:result.state,step:'done',result});
      // Write the pending item's result in the same commit as the asset.
      const row=state.jobs.find(x=>x.job.id===job.id)!;row.items=[...items,result];
      await deps.store.commit(state.revision,state);
      items.push(result);seen.set(requestKey(input),result);
    }
    job=moveJob(job,ctx?.signal?.aborted?'cancelled':'completed');
  }catch(error){job={...moveJob(job,'failed'),error:message(error)};}
  state=await deps.store.read();putJob(state);
  await deps.store.commit(state.revision,state);
  return {job,items};
}
