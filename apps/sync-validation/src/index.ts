import {syncClips,type AudioSampleProvider} from "@pea/sync";
export interface ValidationMedia{clipId:string;path:string}
export interface ValidationCase{id:string;reference:ValidationMedia;target:ValidationMedia;expectedOffsetSamples:string}
export interface ValidationManifest{version:1;sampleRate:number;toleranceSamples:number;cases:ValidationCase[]}
export interface ValidationCaseResult{id:string;status:"matched"|"review"|"error";expectedOffsetSamples:string;measuredOffsetSamples?:string;errorSamples?:string;passed:boolean;reason?:string;confidence?:number}
export interface ValidationReport{version:1;sampleRate:number;toleranceSamples:number;cases:ValidationCaseResult[]}
export function validateManifest(input:any):ValidationManifest{
 if(input?.version!==1||!Number.isSafeInteger(input.sampleRate)||input.sampleRate<=0||!Number.isSafeInteger(input.toleranceSamples)||input.toleranceSamples<0||!Array.isArray(input.cases))throw new Error("invalid validation manifest");
 const ids=new Set<string>();for(const c of input.cases){if(!c?.id||ids.has(c.id))throw new Error(`duplicate or missing case id: ${c?.id??""}`);ids.add(c.id);if(!c.reference?.clipId||!c.reference?.path||!c.target?.clipId||!c.target?.path)throw new Error("media clipId/path required");try{BigInt(c.expectedOffsetSamples)}catch{throw new Error("expectedOffsetSamples must be an integer string");}}
 return input;
}
export async function runValidation(input:ValidationManifest,options:{provider:AudioSampleProvider}):Promise<ValidationReport>{
 const manifest=validateManifest(input),results:ValidationCaseResult[]=[];
 for(const c of manifest.cases){try{
  const group=await syncClips(`validation:${c.id}`,[{clipId:c.reference.clipId,hasAudio:true},{clipId:c.target.clipId,hasAudio:true}],{audioProvider:options.provider,referenceClipId:c.reference.clipId,audioOnly:true});
  const candidate=group.candidates.find(x=>x.clipId===c.target.clipId);
  if(!candidate||candidate.status!=="matched"||!candidate.offset){results.push({id:c.id,status:"review",expectedOffsetSamples:c.expectedOffsetSamples,passed:false,reason:candidate?.reason??"MISSING_EVIDENCE",confidence:candidate?.confidence.score});continue;}
  if(candidate.offset.timebase.numerator!==1||candidate.offset.timebase.denominator!==manifest.sampleRate)throw new Error("measured offset sample rate mismatch");
  const measured=candidate.offset.ticks,expected=BigInt(c.expectedOffsetSamples),error=measured-expected;
  results.push({id:c.id,status:"matched",expectedOffsetSamples:String(expected),measuredOffsetSamples:String(measured),errorSamples:String(error),passed:(error<0n?-error:error)<=BigInt(manifest.toleranceSamples),reason:candidate.reason,confidence:candidate.confidence.score});
 }catch(error){results.push({id:c.id,status:"error",expectedOffsetSamples:c.expectedOffsetSamples,passed:false,reason:error instanceof Error?error.message:"unknown error"});}}
 return{version:1,sampleRate:manifest.sampleRate,toleranceSamples:manifest.toleranceSamples,cases:results};
}
export function renderMarkdown(report:ValidationReport):string{
 const rows=report.cases.map(c=>`| ${c.id} | ${c.status} | ${c.expectedOffsetSamples} | ${c.measuredOffsetSamples??"—"} | ${c.errorSamples??"—"} | ${c.passed?"PASS":"FAIL/REVIEW"} | ${c.reason??""} |`);
 return["# Sync validation report","",`Sample rate: ${report.sampleRate} Hz · tolerance: ±${report.toleranceSamples} samples`,"","| Case | Status | Expected | Measured | Error | Result | Reason |","|---|---|---:|---:|---:|---|---|",...rows].join("\n");
}
