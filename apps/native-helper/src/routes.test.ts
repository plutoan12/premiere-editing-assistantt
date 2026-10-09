import {describe,it,expect} from 'vitest';import {createHelperServer} from './server.js';
describe('helper media routes',()=>{
 it('authenticates and invokes injected media probe',async()=>{
  let seen='';const h=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'s',probe:async p=>{seen=p;return {durationSeconds:1,audioStreams:[],videoStreams:[]}}});
  try{const r=await fetch(h.address+'/v1/media/probe',{method:'POST',headers:{authorization:'Bearer s','content-type':'application/json'},body:JSON.stringify({path:'/tmp/a.mov'})});expect(r.status).toBe(200);expect(seen).toBe('/tmp/a.mov')}finally{await h.close()}
 });
 it('rejects oversized request bodies before handler work',async()=>{
  let called=false;const h=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'s',probe:async()=>{called=true;return {} as any}});
  try{const r=await fetch(h.address+'/v1/media/probe',{method:'POST',headers:{authorization:'Bearer s','content-type':'application/json'},body:JSON.stringify({path:'x'.repeat(70000)})});expect(r.status).toBe(413);expect(called).toBe(false)}finally{await h.close()}
 });
});
