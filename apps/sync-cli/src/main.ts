import { runManifestFile } from './job.js';
const [manifest,output,...extra]=process.argv.slice(2);
if(!manifest||!output||extra.length){console.error('Usage: pnpm sync:files <job.json> <new-output-directory>');process.exitCode=1;}
else {
  const controller=new AbortController();const cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try{
    const report=await runManifestFile(manifest,output,{signal:controller.signal});
    console.log(JSON.stringify({sync:report.group.status,premiere:report.premiere.status,reason:report.premiere.reason,
      output,humanReview:'pending'},null,2));
    if(report.group.status!=='matched'||report.premiere.status!=='ready-for-review')process.exitCode=2;
  }catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=controller.signal.aborted?130:1;}
  finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
