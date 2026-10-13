import { homedir } from 'node:os';
import { join } from 'node:path';
import { createFileHelper } from './file-helper.js';
import { runProcess } from './process-runner.js';
async function main():Promise<void>{
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node 22 이상이 필요해.');
  await runProcess(process.env.PEA_FFMPEG_PATH??'ffmpeg',['-version'],{timeoutMs:5000});
  await runProcess(process.env.PEA_FFPROBE_PATH??'ffprobe',['-version'],{timeoutMs:5000});
  const args=process.argv.slice(2);if(args.length && (args.length!==2||args[0]!=='--session-root'))throw new Error('사용법: node cli.cjs [--session-root 폴더]');
  const helper=await createFileHelper({sessionRoot:args[1]??join(homedir(),'PEA Sync Sessions')});
  console.log('PEA Sync Helper 0.2.0\nPremiere 패널에서 아래 세션 폴더를 선택해. 터미널은 실행 상태로 유지해.');
  console.log(helper.directory);
  console.log('이 폴더는 세션 토큰을 포함해. 공유하거나 GitHub에 올리지 마. 종료: Ctrl+C');
  let closing=false;
  const stop=()=>{if(closing)return;closing=true;void helper.close().then(()=>{process.exitCode=0;}).catch(()=>{process.exitCode=1;});};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Helper 시작 실패');process.exitCode=1;});
