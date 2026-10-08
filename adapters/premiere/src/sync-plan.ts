import type {MediaTime} from "@pea/core";
import type {SyncGroup} from "@pea/sync";
import type {PremiereProjectSnapshot,PremiereSyncDryRun,PremiereSyncOptions,PremiereSyncOperation} from "./types.js";

type Rational={n:bigint;d:bigint};
function gcd(a:bigint,b:bigint):bigint {a=a<0n?-a:a;b=b<0n?-b:b;while(b){const r=a%b;a=b;b=r;}return a;}
function rational(n:bigint,d:bigint):Rational {
 if(d<=0n) throw new Error("invalid timebase denominator");
 const g=gcd(n,d)||1n;return {n:n/g,d:d/g};
}
function time(t:MediaTime):Rational {
 const {numerator,denominator}=t.timebase;
 if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||numerator<=0||denominator<=0) throw new Error("invalid media timebase");
 return rational(t.ticks*BigInt(numerator),BigInt(denominator));
}
function compare(a:Rational,b:Rational):number {const delta=a.n*b.d-b.n*a.d;return delta<0n?-1:delta>0n?1:0;}
function subtract(a:Rational,b:Rational):Rational {return rational(a.n*b.d-b.n*a.d,a.d*b.d);}
function nearestFrame(t:Rational,fpsN:bigint,fpsD:bigint):bigint {
 const n=t.n*fpsN,d=t.d*fpsD;
 // Nonnegative positions, round half up.
 return (2n*n+d)/(2n*d);
}
export function buildSyncDryRun(group:SyncGroup,snapshot:PremiereProjectSnapshot,options:PremiereSyncOptions):PremiereSyncDryRun {
 const warnings:string[]=[],errors:string[]=[],operations:PremiereSyncOperation[]=[];
 const result=()=>({sequenceName:options.sequenceName,projectId:snapshot.projectId,projectVersion:snapshot.projectVersion,operations,warnings,errors});
 if(snapshot.sequenceNames.includes(options.sequenceName)) errors.push(`sequence already exists: ${options.sequenceName}`);
 const fps=options.frameRate;
 if(!Number.isSafeInteger(fps.numerator)||!Number.isSafeInteger(fps.denominator)||fps.numerator<=0||fps.denominator<=0) errors.push("invalid frame rate");
 const matchedIds=new Set([group.referenceClipId,...group.candidates.filter(x=>x.status==="matched").map(x=>x.clipId)]);
 const seen=new Set<string>(),mediaIds=new Set<string>();
 const members=group.members.filter(m=>{
  if(seen.has(m.clipId)){errors.push(`duplicate clipId: ${m.clipId}`);return false;}
  seen.add(m.clipId);
  if(!matchedIds.has(m.clipId)){warnings.push(`unapproved member excluded: ${m.clipId}`);return false;}
  if(m.mediaAssetId && mediaIds.has(m.mediaAssetId)){errors.push(`duplicate mediaAssetId: ${m.mediaAssetId}`);return false;}
  if(m.mediaAssetId) mediaIds.add(m.mediaAssetId);
  return true;
 });
 const raw:{m:typeof members[number];t:Rational}[]=[];
 for(const m of members){
  const matches=snapshot.media.filter(x=>x.clipId===m.clipId&&(!m.mediaAssetId||x.mediaAssetId===m.mediaAssetId));
  if(matches.length!==1) errors.push(`missing or ambiguous stable media mapping: ${m.clipId}`);
  if(m.offsetTicks!==m.offset.ticks) errors.push(`offset alias mismatch: ${m.clipId}`);
  try{raw.push({m,t:time(m.offset)});}catch(e){errors.push(`${m.clipId}: ${String(e)}`);}
 }
 if(!raw.length) errors.push("no approved sync members");
 if(errors.length) return result();
 let min=raw[0].t;
 for(const x of raw) if(compare(x.t,min)<0) min=x.t;
 const fpsN=BigInt(fps.numerator),fpsD=BigInt(fps.denominator);
 raw.forEach(({m,t},trackIndex)=>{
  const normalized=subtract(t,min);
  const frame=nearestFrame(normalized,fpsN,fpsD);
  if(frame>BigInt(Number.MAX_SAFE_INTEGER)) {errors.push(`timeline frame exceeds safe integer: ${m.clipId}`);return;}
  const quantized=Number(frame)*fps.denominator/fps.numerator;
  const exact=Number(normalized.n)/Number(normalized.d);
  const error=quantized-exact;
  if(Math.abs(error)>1e-12) warnings.push(`${m.clipId} quantized by ${error} seconds`);
  const media=snapshot.media.find(x=>x.clipId===m.clipId&&(!m.mediaAssetId||x.mediaAssetId===m.mediaAssetId))!;
  operations.push({kind:"place",clipId:m.clipId,projectItemId:media.projectItemId,startSeconds:quantized,trackIndex,quantizationErrorSeconds:error});
 });
 if(errors.length) operations.length=0;
 return result();
}
