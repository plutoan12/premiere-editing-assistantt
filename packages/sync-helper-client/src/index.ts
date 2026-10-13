import type {AudioSampleProvider,SyncEvidence} from "@pea/sync";
export class HelperClientError extends Error{constructor(public readonly code:string,message:string){super(message);this.name="HelperClientError";}}
export interface HelperAudioProviderConfig{baseUrl:string;token:string;paths:Record<string,string>;sampleRate:number;startSeconds:number;durationSeconds:number}
export function createHelperAudioProvider(config:HelperAudioProviderConfig):AudioSampleProvider{
 return{id:"pea-native-helper",version:"v1",async read(clip:SyncEvidence,context){
  const path=config.paths[clip.clipId];if(!path)throw new HelperClientError("PATH_NOT_FOUND",`no path for clip ${clip.clipId}`);
  const response=await fetch(new URL("/v1/audio/window",config.baseUrl),{method:"POST",headers:{authorization:`Bearer ${config.token}`,"content-type":"application/json","x-pea-protocol":"v1"},body:JSON.stringify({path,startSeconds:config.startSeconds,durationSeconds:config.durationSeconds,sampleRate:config.sampleRate}),signal:context?.signal});
  if(!response.ok){let body:any={};try{body=await response.json();}catch{}throw new HelperClientError(String(body.error??`HTTP_${response.status}`),String(body.message??response.statusText));}
  const rate=Number(response.headers.get("x-pea-sample-rate")),start=response.headers.get("x-pea-start-sample");const buffer=await response.arrayBuffer();
  if(!Number.isSafeInteger(rate)||rate<=0||start===null||buffer.byteLength%4!==0)throw new HelperClientError("INVALID_RESPONSE","invalid PCM response metadata");
  const view=new DataView(buffer),samples=new Float32Array(buffer.byteLength/4);for(let i=0;i<samples.length;i++)samples[i]=view.getFloat32(i*4,true);
  return{samples,sampleRate:rate,startSample:BigInt(start)};
 }};
}
