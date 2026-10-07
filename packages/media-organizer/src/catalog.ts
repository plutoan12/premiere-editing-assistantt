import {z} from 'zod';
import {MediaAssetSchema,ClipReferenceSchema,MediaTimeSchema,ArtifactSchema,MediaDocumentSchema,validateBoundedTimeRange} from '@pea/core';
export type IdFactory = () => string;
export const AssetRecordSchema=z.object({
  asset:MediaAssetSchema,fileRevision:z.number().int().positive(),locations:z.array(z.string().min(1)).min(1),
  duration:MediaTimeSchema.optional(),availability:z.enum(['online','offline','unknown']),
  analysis:z.object({artifact:ArtifactSchema,providerVersion:z.string().min(1),settingsKey:z.string().min(1)}).strict().optional(),
}).strict();
export type AssetRecord=z.infer<typeof AssetRecordSchema>;
export const HostBindingSchema=z.object({bindingId:z.uuid(),clipId:z.string().min(1),adapterId:z.string().min(1),hostProjectKey:z.string().min(1),hostItemId:z.string().min(1),hostRevision:z.string().min(1)}).strict();
export type HostBinding=z.infer<typeof HostBindingSchema>;
export const CatalogSchema=z.object({
  schemaVersion:z.literal('1.0.0'),catalogId:z.uuid(),revision:z.number().int().nonnegative(),
  assets:z.array(AssetRecordSchema),clips:z.array(ClipReferenceSchema),bindings:z.array(HostBindingSchema),
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
    if(record.duration) validateBoundedTimeRange(clip.sourceRange,record.duration);
  }
  for(const binding of state.bindings) if(!state.clips.some(x=>x.id===binding.clipId)) throw new Error('binding references missing clip');
  return state;
}
export function emptyCatalog(catalogId:string):CatalogState {
  return validateCatalog({schemaVersion:'1.0.0',catalogId,revision:0,assets:[],clips:[],bindings:[]});
}
