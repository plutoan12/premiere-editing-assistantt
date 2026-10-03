import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export function noise(length:number,seed=7):Float32Array {
 return Float32Array.from({length},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/4294967296-.5)*.8;});
}
export async function writeWave(path:string,samples:Float32Array,rate=8000,channels=1):Promise<void>{
 const b=Buffer.alloc(44+samples.length*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);
 for(let i=0;i<samples.length;i++)b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(samples[i]*32767))),44+i*2);await writeFile(path,b);
}
export async function withMedia(fn:(root:string)=>Promise<void>):Promise<void>{const p=await mkdtemp(join(tmpdir(),'pea-media-'));try{await fn(p);}finally{await rm(p,{recursive:true,force:true});}}
export const ffmpeg=process.env.PEA_FFMPEG??'ffmpeg',ffprobe=process.env.PEA_FFPROBE??'ffprobe';
