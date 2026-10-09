import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {timeToSamples,type AudioProvider,type AudioSource} from '@pea/audio';
import {AudioDspService} from './audio-dsp.js';
import {validateMeasureInput,type MeasureInput} from './dsp-meter.js';
import {HelperError,throwIfAborted} from './errors.js';
import {runProcess} from './process-runner.js';

export interface FfmpegLoudnessProviderOptions {
  /** Absolute FFprobe stream index, not the index among audio streams. */
  streamIndex:number;
  monoPolicy:MeasureInput['monoPolicy'];
  ffmpegPath?:string;
  ffprobePath?:string;
  timeoutMs?:number;
  maxDurationSeconds?:number;
}
const layouts:Record<string,readonly string[]>={
  mono:['FC'],stereo:['FL','FR'],
  '5.1':['FL','FR','FC','LFE','BL','BR'],
  '5.1(side)':['FL','FR','FC','LFE','SL','SR'],
  '7.1':['FL','FR','FC','LFE','BL','BR','SL','SR'],
};
function sourcePath(source:AudioSource):string {
  const url=new URL(source.media.uri);
  if(url.protocol!=='file:'||url.search||url.hash||!source.media.readOnly||
     source.media.fingerprint.algorithm!=='sha256'||!/^[a-f0-9]{64}$/i.test(source.media.fingerprint.value)) {
    throw new HelperError('INVALID_SOURCE','Read-only local media with a SHA-256 fingerprint is required',400);
  }
  return fileURLToPath(url);
}

/** Bind stream selection and mono policy into cache identity before running Audio Engine jobs.
 * Only the complete selected stream, from decoded origin, is supported. No cleanup capability.
 */
export async function createFfmpegLoudnessProvider(options:FfmpegLoudnessProviderOptions,signal?:AbortSignal):Promise<AudioProvider> {
  const config={...options};
  const selection=validateMeasureInput({path:'/selection-validation',streamIndex:config.streamIndex,monoPolicy:config.monoPolicy});
  const service=new AudioDspService(config);
  const builds:string[]=[];
  for(const [name,executable] of [['ffmpeg',config.ffmpegPath??'ffmpeg'],['ffprobe',config.ffprobePath??'ffprobe']] as const){
    const result=await runProcess(executable,['-version'],{signal,timeoutMs:10000,maxStdoutBytes:65536});
    const build=result.stdout.toString('utf8');
    if(result.code!==0||!build.startsWith(`${name} version `))throw new HelperError('INVALID_RUNTIME','Could not identify the configured audio runtime',503);
    builds.push(build);
  }
  const ffmpegVersion=builds[0].split(/\r?\n/)[0];
  const version='1/'+createHash('sha256').update(JSON.stringify(builds)).digest('hex');
  return Object.freeze({
    id:`ffmpeg-ebur128-truepeak/stream:${selection.streamIndex}/mono:${selection.monoPolicy}`,
    version,
    async measureLoudness(value:AudioSource,jobSignal:AbortSignal){
      throwIfAborted(jobSignal);
      const source=structuredClone(value),path=sourcePath(source);
      if(timeToSamples(source.range.start,source.sampleRate)!==0n)throw new HelperError('UNSUPPORTED_RANGE','Loudness provider requires the whole selected stream from decoded origin',422);
      const expectedSamples=timeToSamples(source.range.duration,source.sampleRate);
      if(expectedSamples<=0n)throw new HelperError('INVALID_SOURCE','Source duration must be positive',400);
      const measured=await service.measure({path,streamIndex:selection.streamIndex,monoPolicy:selection.monoPolicy},jobSignal);
      throwIfAborted(jobSignal);
      if(measured.sourceSha256!==source.media.fingerprint.value.toLowerCase())throw new HelperError('SOURCE_CHANGED','Measured source does not match the requested fingerprint',409);
      if(measured.scope!=='whole-selected-stream'||measured.streamIndex!==selection.streamIndex||measured.monoPolicy!==selection.monoPolicy||measured.ffmpegVersion!==ffmpegVersion)throw new HelperError('MEASUREMENT_MISMATCH','Measured scope or runtime differs from provider identity',409);
      if(measured.sampleRate!==source.sampleRate||measured.channels!==source.channelCount||BigInt(measured.sampleCount)!==expectedSamples)throw new HelperError('UNSUPPORTED_RANGE','Source format and duration must match the whole selected stream',422);
      if(Math.abs(measured.startSeconds-measured.containerStartSeconds)>1/source.sampleRate)throw new HelperError('ORIGIN_MAPPING_REQUIRED','Nonzero audio origin requires an explicit timeline mapping',422);
      if(source.channelLayout&&JSON.stringify(source.channelLayout)!==JSON.stringify(layouts[measured.channelLayout]))throw new HelperError('CHANNEL_LAYOUT_MISMATCH','Source channel labels must match measured channel order',422);
      return {integratedLufs:measured.integratedLufs,truePeakDbtp:measured.truePeakDbtp};
    },
  });
}
