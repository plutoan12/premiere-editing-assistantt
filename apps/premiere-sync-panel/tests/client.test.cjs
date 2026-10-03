const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseSession,createClient}=require('../client.js');
const session={address:'https://127.0.0.1:32145',sessionToken:'a'.repeat(64),protocolVersion:1};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('accepts only the existing Helper v1 HTTPS bootstrap shape',()=>{
  assert.deepEqual(parseSession(session),session);
  for(const address of ['http://127.0.0.1:32145','https://localhost:32145','https://127.0.0.1:32145@evil.test','https://127.0.0.1:32145/path','https://127.0.0.1:32145?x=1','https://127.0.0.1:65536','https://2130706433:32145']) assert.throws(()=>parseSession({...session,address}));
  for(const protocolVersion of [2,'1','1.0.0',null])assert.throws(()=>parseSession({...session,protocolVersion}));
  assert.throws(()=>parseSession({...session,sessionToken:'x'}));
});
test('sends auth and version only to the fixed helper and forbids redirects',async()=>{
  let observed;const c=createClient(session,{fetchImpl:async(url,options)=>{observed={url,options};return response({ok:true,protocolVersion:1,capabilities:['sync']})}});
  await c.ping();assert.equal(observed.url,session.address+'/v1/ping');assert.equal(observed.options.headers.authorization,'Bearer '+session.sessionToken);assert.equal(observed.options.redirect,'error');assert.equal(observed.options.headers['x-pea-protocol-version'],'1');
});
test('rejects a different Helper protocol that also calls itself version one',async()=>{
  const c=createClient(session,{fetchImpl:async()=>response({ok:true,protocolVersion:1,capabilities:['transcription']})});await assert.rejects(()=>c.ping(),/SYNC_UNSUPPORTED/);
});
test('rejects redirect status instead of accepting its body',async()=>{
  const c=createClient(session,{fetchImpl:async()=>response({ok:true},302)});await assert.rejects(()=>c.ping(),/REDIRECT/);
});
test('does not expose arbitrary server errors or network secrets',async()=>{
  const secret='/Users/private/'+session.sessionToken;
  const c=createClient(session,{fetchImpl:async()=>response({error:{message:secret}},500)});
  await assert.rejects(()=>c.ping(),e=>!e.message.includes(secret));
  const d=createClient(session,{fetchImpl:async()=>{throw new Error(secret)}});await assert.rejects(()=>d.ping(),e=>!e.message.includes(secret));
});
test('bounds an uncooperative fetch by a request deadline',async()=>{
  const c=createClient(session,{timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});await assert.rejects(()=>c.ping(),/TIMEOUT/);
});
test('job identifiers cannot inject another route',async()=>{
  let n=0;const c=createClient(session,{fetchImpl:async()=>{n++;return response({})}});
  await assert.rejects(()=>c.getJob('../media'));assert.equal(n,0);
});
test('does not accept oversized or invalid JSON bodies',async()=>{
  for(const text of ['not json',' '.repeat(65537)]){
    const c=createClient(session,{fetchImpl:async()=>new Response(text,{headers:{'content-type':'application/json'}})});await assert.rejects(()=>c.ping());
  }
});
