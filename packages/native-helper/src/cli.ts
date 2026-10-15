import { runCli } from './launch.js';
import { publicError } from './errors.js';
runCli(process.argv.slice(2)).catch(error=>{
  const safe=publicError(error);console.error(`${safe.code}: ${safe.message}`);process.exitCode=1;
});
