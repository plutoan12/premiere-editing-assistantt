import { mkdtemp, chmod, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HELPER_VERSION, PROTOCOL_VERSION } from './protocol.js';
export interface SessionFile {directory:string;path:string;remove():Promise<void>}
/** Private file bootstrap, not an unauthenticated HTTP endpoint. No overwrite. */
export async function createSession(parent:string,connection:{url:string;token:string}):Promise<SessionFile>{
  const directory=await mkdtemp(join(parent,'pea-session-'));await chmod(directory,0o700);
  const path=join(directory,'session.json');
  try{await writeFile(path,JSON.stringify({...connection,protocolVersion:PROTOCOL_VERSION,helperVersion:HELPER_VERSION,pid:process.pid}),{flag:'wx',mode:0o600});}
  catch(error){await rmdir(directory).catch(()=>{});throw error;}
  return {directory,path,async remove(){
    await unlink(path).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
    // Never recursively remove a directory that might now contain another file.
    await rmdir(directory).catch((error:NodeJS.ErrnoException)=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code??''))throw error;});
  }};
}
