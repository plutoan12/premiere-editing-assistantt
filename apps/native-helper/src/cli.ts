import {startHelperSession} from './bootstrap.js';
import {publicError} from './errors.js';
try {
  const session=await startHelperSession({ffmpegPath:process.env.PEA_FFMPEG_PATH,ffprobePath:process.env.PEA_FFPROBE_PATH});
  // The token is intentionally not printed. The launcher reads the private session file.
  console.log(JSON.stringify({event:'ready',protocolVersion:1,sessionFile:session.sessionFile}));
  const stop=()=>{void session.close().catch(()=>{console.error('Helper shutdown failed');process.exitCode=1})};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
} catch(error) {
  console.error(JSON.stringify({event:'startup-failed',error:publicError(error).code}));process.exitCode=1;
}
