import {afterEach,expect,it,vi} from 'vitest';
import {AudioDspService,type AudioMeasurement,type NormalizationReport} from './audio-dsp.js';
import {createHelperServer} from './server.js';

afterEach(()=>vi.restoreAllMocks());
const input={path:'/source.wav',streamIndex:0,monoPolicy:'native'};
const normalization={...input,approved:true,target:{integratedLufs:-23,truePeakDbtp:-2,loudnessRangeLu:11},allowDynamic:false};

it('registers both DSP jobs, validates before queueing and keeps normalization approval explicit',async()=>{
 const measure=vi.spyOn(AudioDspService.prototype,'measure').mockResolvedValue({sampleCount:96000} as AudioMeasurement);
 const normalize=vi.spyOn(AudioDspService.prototype,'normalize').mockResolvedValue({humanReview:'pending'} as NormalizationReport);
 const helper=await createHelperServer({host:'127.0.0.1',port:0});
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${helper.sessionToken}`};
 const submit=(kind:string,value:unknown)=>fetch(helper.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind,input:value})});
 try {
  for(const [kind,value,result] of [
   ['audio-measure',input,{sampleCount:96000}],
   ['audio-normalize',normalization,{humanReview:'pending'}],
  ] as const){
   const response=await submit(kind,value);expect(response.status).toBe(202);
   const {id}=await response.json() as {id:string};
   await expect.poll(async()=>await (await fetch(helper.address+`/v1/jobs/${id}`,{headers})).json()).toMatchObject({status:'completed',result});
   expect((await fetch(helper.address+`/v1/jobs/${id}/audio`,{headers})).status).toBe(409);
  }
  expect((await submit('audio-measure',{...input,outputRoot:'/arbitrary'})).status).toBe(400);
  expect((await submit('audio-normalize',{...normalization,approved:false})).status).toBe(400);
  expect(measure).toHaveBeenCalledTimes(1);expect(normalize).toHaveBeenCalledTimes(1);
 } finally {await helper.close();}
});

it('DSP work shares media concurrency and receives job cancellation',async()=>{
 const signals:AbortSignal[]=[];
 vi.spyOn(AudioDspService.prototype,'measure').mockImplementation(async(_input,signal)=>{
  signals.push(signal!);
  return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));
 });
 const probe=vi.fn();
 const helper=await createHelperServer({host:'127.0.0.1',port:0,probe});
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${helper.sessionToken}`};
 try {
  const ids:string[]=[];
  for(let i=0;i<2;i++){
   const r=await fetch(helper.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'audio-measure',input})});
   expect(r.status).toBe(202);ids.push((await r.json() as {id:string}).id);
  }
  await expect.poll(()=>signals.length).toBe(2);
  expect((await fetch(helper.address+'/v1/media/probe',{method:'POST',headers,body:JSON.stringify({path:input.path})})).status).toBe(429);
  expect(probe).not.toHaveBeenCalled();
  expect((await fetch(helper.address+`/v1/jobs/${ids[0]}/cancel`,{method:'POST',headers})).status).toBe(200);
  expect(signals[0].aborted).toBe(true);
  await helper.close();expect(signals[1].aborted).toBe(true);
 } finally {await helper.close();}
});
