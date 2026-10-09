import {mkdtemp,writeFile,chmod,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHelperServer} from './server.js';
export async function startHelperSession(options: {ffmpegPath?: string; ffprobePath?: string; audioOutputRoot?: string} = {}): Promise<{sessionFile: string; close(): Promise<void>}> {
  const helper=await createHelperServer({host:'127.0.0.1',port:0,...options});
  let directory:string|undefined;
  try {
    directory=await mkdtemp(join(tmpdir(),'pea-native-helper-'));
    await chmod(directory,0o700);
    const sessionFile=join(directory,'session.json');
    await writeFile(sessionFile,JSON.stringify({protocolVersion:1,address:helper.address,sessionToken:helper.sessionToken}),{flag:'wx',mode:0o600});
    let closed:Promise<void>|undefined;
    return {sessionFile,close:()=>closed??=(async()=>{
      await helper.close();
      await unlink(sessionFile);
      try {await rmdir(directory!);} catch(error) {if ((error as NodeJS.ErrnoException).code!=='ENOTEMPTY') throw error;}
    })()};
  } catch(error) {
    await helper.close();
    if(directory) {await unlink(join(directory,'session.json')).catch(()=>{});await rmdir(directory).catch(()=>{});}
    throw error;
  }
}
