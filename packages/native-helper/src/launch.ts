import { tmpdir } from 'node:os';
import { HelperError } from './errors.js';
import { MediaService } from './media.js';
import { startHelper } from './server.js';
import { createSession } from './session.js';
import { runProcess } from './process.js';
export interface Arguments {roots:string[];sessionParent:string;help:boolean;check:boolean}
export function parseArguments(args:readonly string[]):Arguments{
  const parsed:Arguments={roots:[],sessionParent:tmpdir(),help:false,check:false};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--help'){parsed.help=true;continue;}
    if(arg==='--check'){parsed.check=true;continue;}
    if(!['--media-root','--session-parent'].includes(arg)||!args[i+1]||args[i+1].startsWith('--'))throw new HelperError('INVALID_ARGUMENT','Use --media-root PATH, --session-parent PATH, --check, or --help');
    const value=args[++i];if(arg==='--media-root')parsed.roots.push(value);else parsed.sessionParent=value;
  }
  if(!parsed.roots.length&&!parsed.help&&!parsed.check)throw new HelperError('ROOT_REQUIRED','Start with --media-root and an approved media folder');
  return parsed;
}
export async function runCli(args:readonly string[]):Promise<void>{
  const parsed=parseArguments(args);
  if(parsed.help){console.log('Usage: node pea-helper.mjs --media-root /absolute/media/folder [--media-root /another/folder]\nOptions: --session-parent PATH | --check | --help\nRequires Node 22 and user-installed FFmpeg/ffprobe. No files are uploaded.');return;}
  const ffmpeg=process.env.PEA_FFMPEG??'ffmpeg',ffprobe=process.env.PEA_FFPROBE??'ffprobe';
  for(const executable of [ffmpeg,ffprobe])await runProcess(executable,['-version'],{timeoutMs:5000,maxOutputBytes:65536});
  if(parsed.check){console.log('FFmpeg and ffprobe are executable.');return;}
  const media=await MediaService.create({roots:parsed.roots,ffmpeg,ffprobe});
  const server=await startHelper({media});
  let session:Awaited<ReturnType<typeof createSession>>;
  try{session=await createSession(parsed.sessionParent,server);}catch(error){await server.close();throw error;}
  let closing:Promise<void>|undefined;
  const close=()=>{closing??=(async()=>{await server.close();await session.remove();process.off('SIGINT',stop);process.off('SIGTERM',stop);})();return closing;};
  const stop=()=>{void close().catch(()=>{process.exitCode=1;});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  // A launcher can read this line and then the mode-0600 file. Never print the token.
  console.log(JSON.stringify({url:server.url,sessionFile:session.path}));
}
