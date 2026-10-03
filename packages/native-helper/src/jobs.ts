import { randomUUID } from 'node:crypto';
import { HelperError, publicError } from './errors.js';
import { integer } from './protocol.js';
export type JobStatus='queued'|'running'|'completed'|'failed'|'cancelled';
export interface JobSnapshot {id:string;status:JobStatus;progress:number;result?:unknown;error?:{code:string;message:string}}
export type JobWork=(signal:AbortSignal,progress:(value:number)=>void)=>Promise<unknown>;
interface Entry {snapshot:JobSnapshot;controller:AbortController;work:JobWork}
export class JobQueue {
  private readonly entries=new Map<string,Entry>();
  private readonly capacity:number;private readonly timeoutMs:number;
  private active?:{id:string;done:Promise<void>};private stopped=false;
  constructor(options:{capacity?:number;timeoutMs?:number}={}){
    this.capacity=integer(options.capacity??32,1,256,'job capacity');this.timeoutMs=integer(options.timeoutMs??120000,1,600000,'job timeout');
  }
  submit(work:JobWork):JobSnapshot{
    if(this.stopped)throw new HelperError('SHUTTING_DOWN','Helper is shutting down',503);
    if(this.entries.size>=this.capacity){
      const expired=[...this.entries.values()].find(e=>!['queued','running'].includes(e.snapshot.status)&&e.snapshot.id!==this.active?.id);
      if(!expired)throw new HelperError('QUEUE_FULL','Too many pending jobs',429);
      this.entries.delete(expired.snapshot.id);
    }
    const snapshot:JobSnapshot={id:randomUUID(),status:'queued',progress:0};
    this.entries.set(snapshot.id,{snapshot,controller:new AbortController(),work});
    queueMicrotask(()=>this.drain());return structuredClone(snapshot);
  }
  private entry(id:string):Entry{const e=this.entries.get(id);if(!e)throw new HelperError('JOB_NOT_FOUND','Job is no longer available',404);return e;}
  get(id:string):JobSnapshot{return structuredClone(this.entry(id).snapshot);}
  cancel(id:string):JobSnapshot{
    const e=this.entry(id);if(['queued','running'].includes(e.snapshot.status)){e.snapshot.status='cancelled';e.controller.abort();}
    return this.get(id);
  }
  remove(id:string):void{
    const e=this.entry(id);if(['queued','running'].includes(e.snapshot.status)||this.active?.id===id)throw new HelperError('JOB_ACTIVE','Cancel and finish the active job before removing it',409);
    this.entries.delete(id);
  }
  private drain():void{
    if(this.stopped||this.active)return;
    const e=[...this.entries.values()].find(x=>x.snapshot.status==='queued');if(!e)return;
    e.snapshot.status='running';
    const timer=setTimeout(()=>{
      if(e.snapshot.status!=='running')return;
      e.snapshot.status='failed';e.snapshot.error={code:'JOB_TIMEOUT',message:'Job exceeded its time limit'};e.controller.abort();
    },this.timeoutMs);
    const done=Promise.resolve().then(()=>e.work(e.controller.signal,value=>{
      if(e.snapshot.status==='running'&&Number.isFinite(value))e.snapshot.progress=Math.max(e.snapshot.progress,Math.min(1,Math.max(0,value)));
    })).then(result=>{
      if(e.snapshot.status==='running'){e.snapshot.result=structuredClone(result);e.snapshot.status='completed';e.snapshot.progress=1;}
    }).catch(error=>{
      if(e.snapshot.status==='running'){const safe=publicError(error);e.snapshot.status=safe.code==='CANCELLED'?'cancelled':'failed';e.snapshot.error={code:safe.code,message:safe.message};}
    }).finally(()=>{clearTimeout(timer);this.active=undefined;queueMicrotask(()=>this.drain());});
    this.active={id:e.snapshot.id,done};
  }
  async close():Promise<void>{
    this.stopped=true;for(const id of this.entries.keys())this.cancel(id);await this.active?.done;
  }
}
