import {describe,it,expect} from 'vitest';
import {createHelperServer} from './server.js';

describe('native helper server',()=>{
 it('rejects non-loopback bind hosts',async()=>{await expect(createHelperServer({host:'0.0.0.0',port:0})).rejects.toThrow(/loopback/i)});
 it('exposes health without auth and protects v1 routes',async()=>{
  const helper=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'secret'});
  try {
   const health=await fetch(helper.address+'/health'); expect(health.status).toBe(200);
   const info=await health.json() as any; expect(info.protocolVersion).toBe(1);
   expect((await fetch(helper.address+'/v1/ping')).status).toBe(401);
   expect((await fetch(helper.address+'/v1/ping',{headers:{authorization:'Bearer wrong'}})).status).toBe(401);
   expect((await fetch(helper.address+'/v1/ping',{headers:{authorization:'Bearer secret'}})).status).toBe(200);
  } finally {await helper.close()}
 });
 it('generates a non-empty session token when omitted',async()=>{
  const helper=await createHelperServer({host:'127.0.0.1',port:0});
  try {expect(helper.sessionToken.length).toBeGreaterThanOrEqual(32)} finally {await helper.close()}
 });
});
