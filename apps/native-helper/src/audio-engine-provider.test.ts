import {afterEach,expect,it,vi} from 'vitest';
import {AudioCache,runAudioJob,type AudioSource} from '@pea/audio';
import {AudioDspService,type AudioMeasurement} from './audio-dsp.js';
import * as processRunner from './process-runner.js';
import {createFfmpegLoudnessProvider} from './audio-engine-provider.js';
import {validateMeasureInput} from './dsp-meter.js';

afterEach(()=>vi.restoreAllMocks());
const source=():AudioSource=>({media:{id:'media',uri:'file:///source.wav',readOnly:true,fingerprint:{algorithm:'sha256',value:'a'.repeat(64)}},range:{start:{ticks:0n,timebase:{numerator:1,denominator:48000}},duration:{ticks:96000n,timebase:{numerator:1,denominator:48000}}},sampleRate:48000,channelCount:2,channelLayout:['FL','FR']});
const measurement=():AudioMeasurement=>({schemaVersion:1,scope:'whole-selected-stream',streamIndex:0,monoPolicy:'native',sourceSha256:'a'.repeat(64),ffmpegVersion:'ffmpeg version fixture',meter:'ffmpeg-ebur128-truepeak',status:'measured',integratedLufs:-23,truePeakDbtp:-3,loudnessRangeLu:1,sampleCount:96000,sampleRate:48000,channels:2,channelLayout:'stereo',durationSeconds:2,startSeconds:0,containerStartSeconds:0});
function versions(){return vi.spyOn(processRunner,'runProcess').mockImplementation(async exe=>({code:0,stdout:Buffer.from(exe.includes('ffprobe')?'ffprobe version fixture':'ffmpeg version fixture'),stderr:Buffer.alloc(0)}));}
const selection={streamIndex:0,monoPolicy:'native' as const};

it('bridges real meter fields into an Audio Engine artifact and separates stream/policy/build caches',async()=>{
 const runtime=versions();const meter=vi.spyOn(AudioDspService.prototype,'measure').mockImplementation(async input=>({...measurement(),...validateMeasureInput(input)}));
 const provider=await createFfmpegLoudnessProvider(selection),cache=new AudioCache();
 const request={jobId:'j',artifactId:'a',artifactVersion:1,attempt:0,source:source(),operation:'loudness' as const,settings:{}};
 const options={cache,isCurrent:()=>true};
 const first=await runAudioJob(request,provider,options);expect(first.job.status).toBe('completed');expect(first.artifact?.payload).toEqual({integratedLufs:-23,truePeakDbtp:-3});
 expect((await runAudioJob(request,provider,options)).cacheHit).toBe(true);
 const other=await createFfmpegLoudnessProvider({...selection,streamIndex:1});expect((await runAudioJob(request,other,options)).cacheHit).toBe(false);
 const dual=await createFfmpegLoudnessProvider({...selection,monoPolicy:'dual-mono'});expect((await runAudioJob(request,dual,options)).cacheHit).toBe(false);
 expect(meter).toHaveBeenCalledTimes(3);
 runtime.mockImplementation(async exe=>({code:0,stdout:Buffer.from(exe.includes('ffprobe')?'ffprobe version newer':'ffmpeg version fixture'),stderr:Buffer.alloc(0)}));
 expect((await createFfmpegLoudnessProvider(selection)).version).not.toBe(provider.version);
 expect(provider.cleanup).toBeUndefined();
});

it.each([
 {sourceSha256:'b'.repeat(64)}, {sampleCount:95999}, {sampleRate:44100}, {channels:1},
 {channelLayout:'5.1'}, {streamIndex:1}, {monoPolicy:'dual-mono' as const},
 {startSeconds:0.1}, {ffmpegVersion:'ffmpeg version changed'},
])('rejects measurement for different source, scope or runtime: %j',async patch=>{
 versions();vi.spyOn(AudioDspService.prototype,'measure').mockResolvedValue({...measurement(),...patch});
 const provider=await createFfmpegLoudnessProvider(selection);
 await expect(provider.measureLoudness!(source(),new AbortController().signal)).rejects.toThrow();
});

it('rejects partial ranges and swapped channel labels, and propagates cancellation',async()=>{
 versions();const meter=vi.spyOn(AudioDspService.prototype,'measure').mockResolvedValue(measurement());
 const provider=await createFfmpegLoudnessProvider(selection);
 const partial=source();partial.range.start.ticks=1n;
 await expect(provider.measureLoudness!(partial,new AbortController().signal)).rejects.toThrow(/whole/i);expect(meter).not.toHaveBeenCalled();
 const swapped=source();swapped.channelLayout=['FR','FL'];
 await expect(provider.measureLoudness!(swapped,new AbortController().signal)).rejects.toThrow(/channel/i);
 const c=new AbortController();c.abort();
 await expect(provider.measureLoudness!(source(),c.signal)).rejects.toMatchObject({name:'AbortError'});
 const during=new AbortController();
 meter.mockImplementation(async(_input,signal)=>{
  expect(signal).toBe(during.signal);
  const pending=new Promise<never>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));
  during.abort();return pending;
 });
 await expect(provider.measureLoudness!(source(),during.signal)).rejects.toMatchObject({name:'AbortError'});
});
