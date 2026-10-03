import { HelperError } from './errors.js';
export const PROTOCOL_VERSION=1;
export const HELPER_VERSION='0.1.0';
export const MAX_SAMPLES=262144;
export function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HelperError('INVALID_REQUEST','An object is required');
  const r=value as Record<string,unknown>;
  if(Object.keys(r).some(key=>!keys.includes(key)))throw new HelperError('INVALID_REQUEST','Unknown request field');
  return r;
}
export function text(value:unknown,label:string,max=256):string{
  if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw new HelperError('INVALID_REQUEST',`Invalid ${label}`);
  return value;
}
export function integer(value:unknown,min:number,max:number,label:string):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new HelperError('INVALID_REQUEST',`Invalid ${label}`);
  return value;
}
export interface WindowSpec {sampleRate:number;startSample:string;sampleCount:number;stream?:number;channel:number}
export function parseWindow(value:unknown):WindowSpec{
  const r=object(value,['sampleRate','startSample','sampleCount','stream','channel']);
  const sampleRate=integer(r.sampleRate??8000,8000,48000,'sample rate');
  if(![8000,16000,48000].includes(sampleRate))throw new HelperError('INVALID_REQUEST','Supported sample rates are 8000, 16000, 48000');
  const startSample=r.startSample??'0';
  if(typeof startSample!=='string'||!/^(0|[1-9][0-9]{0,11})$/.test(startSample)||BigInt(startSample)>BigInt(sampleRate)*86400n)throw new HelperError('INVALID_REQUEST','Invalid window start sample');
  return {sampleRate,startSample,sampleCount:integer(r.sampleCount??80000,16,MAX_SAMPLES,'sample count'),
    stream:r.stream===undefined?undefined:integer(r.stream,0,255,'audio stream'),channel:integer(r.channel??0,0,63,'audio channel')};
}
/** Exact integer time transport: bigint values are decimal strings, never floats. */
export function json(value:unknown):string{return JSON.stringify(value,(_key,v)=>typeof v==='bigint'?v.toString():v);}
