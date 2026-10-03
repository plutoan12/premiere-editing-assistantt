import {randomUUID} from 'node:crypto';
export type JobStatus='queued'|'running'|'completed'|'failed'|'cancelled';
export interface JobRecord{ id:string;kind:string;status:JobStatus;result?:unknown;error?:string }
type Internal={record:JobRecord;controller:AbortController;done:Promise<void>};
export class JobRegistry{
 private jobs=new Map<string,Internal>();
 submit(kind:string,work:(signal:AbortSignal)=>Promise<unknown>):string{
  const id=randomUUID(),controller=new AbortController(),record:JobRecord={id,kind,status:'queued'};
  const internal={} as Internal;internal.record=record;internal.controller=controller;
  internal.done=Promise.resolve().then(async()=>{if(controller.signal.aborted){record.status='cancelled';return}record.status='running';try{record.result=await work(controller.signal);record.status=controller.signal.aborted?'cancelled':'completed'}catch(e){record.status=controller.signal.aborted?'cancelled':'failed';record.error=e instanceof Error?e.message:String(e)}});
  this.jobs.set(id,internal);return id;
 }
 get(id:string):JobRecord|undefined{const x=this.jobs.get(id);return x?{...x.record}:undefined}
 cancel(id:string):boolean{const x=this.jobs.get(id);if(!x)return false;if(x.record.status==='completed'||x.record.status==='failed')return false;if(x.record.status==='cancelled')return true;x.controller.abort();x.record.status='cancelled';return true}
 delete(id:string):boolean{const x=this.jobs.get(id);if(!x)return false;if(!['completed','failed','cancelled'].includes(x.record.status))return false;return this.jobs.delete(id)}
 async wait(id:string):Promise<void>{const x=this.jobs.get(id);if(!x)throw new Error('unknown job');await x.done}
}
