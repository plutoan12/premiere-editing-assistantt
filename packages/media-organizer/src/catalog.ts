import {z} from 'zod';
import {MediaAssetSchema,ClipReferenceSchema,MediaTimeSchema,ArtifactSchema,MediaDocumentSchema,validateBoundedTimeRange} from '@pea/core';
import {ScanRecordSchema,IngestResultSchema,ProbeRecordSchema} from './scan.js';
import {MetadataRecordSchema,AnnotationSchema,targetKey} from './metadata.js';
import {RuleSetSchema} from './rules.js';
import {SavedSearchSchema} from './search-query.js';
export type IdFactory = () => string;
export const AssetRecordSchema=z.object({
  asset:MediaAssetSchema,fileRevision:z.number().int().positive(),locations:z.array(z.string().min(1)).min(1),
  duration:MediaTimeSchema.optional(),availability:z.enum(['online','offline','unknown']),
  probe:ProbeRecordSchema.optional(),
  analysis:z.object({artifact:ArtifactSchema,providerVersion:z.string().min(1),settingsKey:z.string().min(1)}).strict().optional(),
}).strict();
export type AssetRecord=z.infer<typeof AssetRecordSchema>;
export const HostBindingSchema=z.object({bindingId:z.uuid(),clipId:z.string().min(1),adapterId:z.string().min(1),hostProjectKey:z.string().min(1),hostItemId:z.string().min(1),hostRevision:z.string().min(1)}).strict();
export type HostBinding=z.infer<typeof HostBindingSchema>;
export const CatalogSchema=z.object({
  schemaVersion:z.literal('1.0.0'),catalogId:z.uuid(),revision:z.number().int().nonnegative(),
  assets:z.array(AssetRecordSchema),clips:z.array(ClipReferenceSchema),bindings:z.array(HostBindingSchema),
  savedSearches:z.array(SavedSearchSchema),
  annotations:z.array(AnnotationSchema),ruleSets:z.array(RuleSetSchema),
  scans:z.array(ScanRecordSchema),jobs:z.array(IngestResultSchema),metadata:z.array(MetadataRecordSchema),
  clipStates:z.array(z.object({clipId:z.string().min(1),fileRevision:z.number().int().positive(),reviewState:z.enum(["confirmed","needs_review"])}).strict()),
}).strict();
export type CatalogState=z.infer<typeof CatalogSchema>;
export interface CatalogStore {
  read():Promise<CatalogState>;
  commit(expectedRevision:number,next:CatalogState):Promise<CatalogState>;
}
export function unique(values:string[],label:string):void {
  if(new Set(values).size!==values.length) throw new Error(`duplicate ${label}`);
}
export function validateCatalog(input:CatalogState):CatalogState {
  const state=CatalogSchema.parse(input);
  MediaDocumentSchema.parse({schemaVersion:'1.0.0',kind:'media',data:{assets:state.assets.map(x=>x.asset),clips:state.clips}});
  unique(state.bindings.map(x=>x.bindingId),'binding ID');
  unique(state.bindings.map(x=>JSON.stringify([x.adapterId,x.hostProjectKey,x.hostItemId])),'host identity');
  for(const record of state.assets) {
    if(!record.locations.includes(record.asset.uri)) throw new Error('canonical URI must be a location');
    unique(record.locations,'asset location');
    if(record.duration && record.duration.ticks<=0n) throw new Error('media duration must be positive');
  }
  for(const clip of state.clips) {
    const record=state.assets.find(x=>x.asset.id===clip.mediaAssetId)!;
    const cs=state.clipStates.find(x=>x.clipId===clip.id);
    if(cs && cs.fileRevision!==record.fileRevision && cs.reviewState!=="needs_review") throw new Error("stale clip must require review");
    if(record.duration && (!cs || cs.fileRevision===record.fileRevision)) validateBoundedTimeRange(clip.sourceRange,record.duration);
  }
  for(const binding of state.bindings) if(!state.clips.some(x=>x.id===binding.clipId)) throw new Error('binding references missing clip');
  unique(state.scans.map(x=>x.scanId),'scan ID');
  unique(state.jobs.map(x=>x.job.id),'job ID');
  unique(state.clipStates.map(x=>x.clipId),'clip state');
  unique(state.metadata.map(x=>`${targetKey(x.target)}:${x.field}`),'metadata field');
  for(const cs of state.clipStates) if(!state.clips.some(x=>x.id===cs.clipId)) throw new Error('clip state references missing clip');
  for(const row of state.metadata) {
    if(!hasTarget(state,row.target)) throw new Error('metadata references missing target');
    if(row.candidates.some(x=>x.field!==row.field)) throw new Error('metadata candidate field mismatch');
  }
  for(const scan of state.scans) {
    if(scan.result?.scanId && scan.result.scanId!==scan.scanId) throw new Error('scan result identity mismatch');
    if(scan.result?.assetId && !state.assets.some(x=>x.asset.id===scan.result?.assetId)) throw new Error('scan references missing asset');
    if(scan.result?.clipId && !state.clips.some(x=>x.id===scan.result?.clipId)) throw new Error('scan references missing clip');
  }
  unique(state.savedSearches.map(x=>x.id),'saved search ID');
  unique(state.annotations.map(x=>x.id),'annotation ID');
  unique(state.ruleSets.map(x=>x.id),'rule set ID');
  for(const a of state.annotations){
    if(!hasTarget(state,a.target))throw new Error('annotation references missing target');
    const assetId=a.target.kind==='asset'?a.target.id:state.clips.find(x=>x.id===a.target.id)!.mediaAssetId;
    const asset=state.assets.find(x=>x.asset.id===assetId)!;
    if(a.range){
      if(a.range.start.ticks<0n||a.range.duration.ticks<=0n)throw new Error('invalid annotation range');
      if(a.reviewState==='confirmed'){
        if(!asset.duration)throw new Error('annotation range requires source duration');
        validateBoundedTimeRange(a.range,asset.duration);
      }
    }
  }
  return state;
}
export function emptyCatalog(catalogId:string):CatalogState {
  return validateCatalog({schemaVersion:'1.0.0',catalogId,revision:0,assets:[],clips:[],bindings:[],scans:[],jobs:[],metadata:[],clipStates:[],annotations:[],ruleSets:[],savedSearches:[]});
}

export function hasTarget(state:CatalogState,target:{kind:'asset'|'clip';id:string}):boolean {
  return target.kind==='asset'?state.assets.some(x=>x.asset.id===target.id):state.clips.some(x=>x.id===target.id);
}
