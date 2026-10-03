import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readTlsOptions} from './tls-options.js';

describe('CLI TLS policy',()=>{
  it('requires a TLS pair unless plaintext development mode is explicit',async()=>{
    await assert.rejects(()=>readTlsOptions({}),/TLS/);
    assert.equal(await readTlsOptions({PEA_ALLOW_HTTP:'1'}),undefined);
    await assert.rejects(()=>readTlsOptions({PEA_TLS_KEY:'/tmp/key.pem',PEA_ALLOW_HTTP:'1'}),/TLS/);
  });
  it('reads a bounded private key without modifying file permissions or the trust store',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'pea-tls-options-'));
    try{
      const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
      await writeFile(key,'private-test-data',{mode:0o600});await writeFile(cert,'certificate-test-data');
      const result=await readTlsOptions({PEA_TLS_KEY:key,PEA_TLS_CERT:cert});
      assert.equal(result!.key.toString(),'private-test-data');
      await chmod(key,0o644);await assert.rejects(()=>readTlsOptions({PEA_TLS_KEY:key,PEA_TLS_CERT:cert}),/TLS/);
    }finally{await rm(dir,{recursive:true,force:true})}
  });
});
