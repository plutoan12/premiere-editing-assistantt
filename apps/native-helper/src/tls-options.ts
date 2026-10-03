import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {HelperError} from './errors.js';
/** Explicit local configuration only. Never installs a CA or disables certificate verification. */
export async function readTlsOptions(env:Record<string,string|undefined>):Promise<{key:Buffer;cert:Buffer}|undefined> {
  const keyPath=env.PEA_TLS_KEY,certPath=env.PEA_TLS_CERT;
  if(!keyPath&&!certPath&&env.PEA_ALLOW_HTTP==='1')return undefined;
  if(!keyPath||!certPath)throw new HelperError('TLS_REQUIRED','TLS certificate and private key paths are required',400);
  async function read(path:string,privateKey:boolean):Promise<Buffer> {
    if(!isAbsolute(path))throw new HelperError('INVALID_TLS','TLS paths must be absolute local paths',400);
    let file:Awaited<ReturnType<typeof open>>|undefined;
    try {
      file=await open(path,'r');const info=await file.stat();
      if(!info.isFile()||info.size<1||info.size>131072||(privateKey&&process.platform!=='win32'&&(info.mode&0o077)!==0))throw new Error('invalid');
      const buffer=Buffer.alloc(131073);let length=0;
      while(length<buffer.length){const result=await file.read(buffer,length,buffer.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
      if(length<1||length>131072)throw new Error('invalid');return buffer.subarray(0,length);
    }catch{throw new HelperError('INVALID_TLS','TLS material must be bounded regular files with a private 0600 key',400);}
    finally{await file?.close();}
  }
  return {key:await read(keyPath,true),cert:await read(certPath,false)};
}
