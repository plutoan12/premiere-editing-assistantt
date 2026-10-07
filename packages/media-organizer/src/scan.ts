import {z} from 'zod';
import {MediaTimeSchema,TimeRangeSchema,FrameRateSchema,JobSchema,type ProviderContext} from '@pea/core';
import {MetadataCandidateSchema} from './metadata.js';
export const FileStampSchema=z.object({size:z.bigint().nonnegative(),mtimeNs:z.bigint(),identity:z.string().optional()}).strict();
export type FileStamp=z.infer<typeof FileStampSchema>;
export interface ReadOnlyFiles {
  stat(uri:string):Promise<FileStamp>;
  sha256(uri:string,ctx?:ProviderContext):Promise<string>;
}
export const ScanInputSchema=z.object({scanId:z.uuid(),uri:z.string().min(1),existingAssetId:z.string().min(1).optional(),sourceRange:TimeRangeSchema.optional()}).strict();
export type ScanInput=z.infer<typeof ScanInputSchema>;
export const ProbeRecordSchema=z.object({mediaKind:z.enum(['video','audio','image','other']),duration:MediaTimeSchema.refine(x=>x.ticks>0n).optional(),frameRate:FrameRateSchema.optional(),width:z.number().int().positive().optional(),height:z.number().int().positive().optional(),audioChannels:z.number().int().nonnegative().optional(),variableFrameRate:z.boolean().optional(),candidates:z.array(MetadataCandidateSchema)}).strict();
export type ProbeRecord=z.infer<typeof ProbeRecordSchema>;
export const IngestItemSchema=z.object({scanId:z.uuid(),state:z.enum(['registered','unchanged','offline','unsupported','changed_during_read','failed','cancelled']),assetId:z.string().optional(),clipId:z.string().optional(),error:z.object({code:z.string(),message:z.string()}).strict().optional()}).strict();
export type IngestItemResult=z.infer<typeof IngestItemSchema>;
export const ScanRecordSchema=ScanInputSchema.extend({state:z.enum(['queued','running',...IngestItemSchema.shape.state.options]),step:z.enum(['queued','reading','done']),stamp:FileStampSchema.optional(),result:IngestItemSchema.optional(),providerVersion:z.string(),settingsKey:z.string()}).strict();
export type ScanRecord=z.infer<typeof ScanRecordSchema>;
export const IngestResultSchema=z.object({job:JobSchema,items:z.array(IngestItemSchema)}).strict();
export type IngestResult=z.infer<typeof IngestResultSchema>;
export const sameStamp=(a:FileStamp,b:FileStamp)=>a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.identity===b.identity;
