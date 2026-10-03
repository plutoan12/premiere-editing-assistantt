import {createReadStream} from 'node:fs';
import {stat,realpath,mkdtemp,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {HelperError,throwIfAborted} from './errors.js';
import {resolveMediaPath,validateLocalPath} from './media-path.js';
export async function sourceFingerprint(path:string,signal?:AbortSignal):Promise<{path:string;sha256:string}> {
  throwIfAborted(signal);const local=await resolveMediaPath(path),before=await stat(local,{bigint:true});
  if(before.size>8n*1024n*1024n*1024n)throw new HelperError('INPUT_LIMIT','Source size limit exceeded',422);
  const hash=createHash('sha256');
  for await(const block of createReadStream(local,{signal})){throwIfAborted(signal);hash.update(block);}
  throwIfAborted(signal);const after=await stat(local,{bigint:true});
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new HelperError('SOURCE_CHANGED','Source changed during reading',409);
  return {path:local,sha256:hash.digest('hex')};
}
export async function outputDirectory(root:string):Promise<string> {
  validateLocalPath(root);let local:string;
  try{local=await realpath(root);if(!(await stat(local)).isDirectory())throw new Error();}catch{throw new HelperError('INVALID_OUTPUT_ROOT','Configured output root must be an existing local directory',400);}
  const dir=await mkdtemp(join(local,'pea-audio-'));await chmod(dir,0o700);return dir;
}
