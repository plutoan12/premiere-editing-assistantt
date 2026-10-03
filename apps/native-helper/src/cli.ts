import {startHelperSession} from './bootstrap.js';
import {publicError} from './errors.js';
import {readTlsOptions} from './tls-options.js';
try {
  const tls=await readTlsOptions(process.env);
  const session=await startHelperSession({tls,ffmpegPath:process.env.PEA_FFMPEG_PATH,ffprobePath:process.env.PEA_FFPROBE_PATH});
  // Only the private session-file path is printed; never a token, key or certificate.
  console.log(JSON.stringify({event:'ready',protocolVersion:1,sessionFile:session.sessionFile}));
  const stop=()=>{void session.close().catch(()=>{console.error('Helper shutdown failed');process.exitCode=1})};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}catch(error){console.error(JSON.stringify({event:'startup-failed',error:publicError(error).code}));process.exitCode=1;}
