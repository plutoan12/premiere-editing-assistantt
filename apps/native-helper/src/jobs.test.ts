import {describe,it,expect} from 'vitest';
import {JobRegistry} from './jobs.js';

describe('job registry',()=>{
 it('runs jobs to completion',async()=>{const r=new JobRegistry();const id=r.submit('x',async()=>42);await r.wait(id);expect(r.get(id)).toMatchObject({status:'completed',result:42})});
 it('cancels running work idempotently',async()=>{const r=new JobRegistry();const id=r.submit('x',signal=>new Promise((_ok,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));expect(r.cancel(id)).toBe(true);expect(r.cancel(id)).toBe(true);await r.wait(id);expect(r.get(id)?.status).toBe('cancelled')});
 it('only deletes terminal jobs',async()=>{const r=new JobRegistry();const id=r.submit('x',async()=>1);expect(r.delete(id)).toBe(false);await r.wait(id);expect(r.delete(id)).toBe(true);expect(r.get(id)).toBeUndefined()});
});
