import {writeFile} from 'node:fs/promises';
/** Tiny deterministic test media only. Not part of the helper's public API. */
export function noise(count:number,seed=7):Float32Array {
 return Float32Array.from({length:count},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/4294967296-.5)*1.6});
}
export async function writeWave(path:string,samples:Float32Array,rate=8000):Promise<void>{
 const b=Buffer.alloc(44+samples.length*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(3,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(32,34);b.write('data',36);b.writeUInt32LE(samples.length*4,40);samples.forEach((s,i)=>b.writeFloatLE(s,44+i*4));await writeFile(path,b);
}
