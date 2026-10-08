import {afterEach,describe,expect,it} from "vitest";
import {createHelperServer} from "./server.js";

const opened: Array<{close():Promise<void>}> = [];
afterEach(async()=>{while(opened.length) await opened.pop()!.close();});

describe("native helper boundary",()=>{
  it("binds only to loopback on an ephemeral port and rotates tokens",async()=>{
    const a=await createHelperServer(); const b=await createHelperServer(); opened.push(a,b);
    expect(a.host).toBe("127.0.0.1"); expect(a.port).toBeGreaterThan(0);
    expect(b.host).toBe("127.0.0.1"); expect(a.token).not.toBe(b.token);
  });
  it("allows health without auth but rejects v1 routes before route logic",async()=>{
    const s=await createHelperServer(); opened.push(s);
    const base=`http://127.0.0.1:${s.port}`;
    expect((await fetch(base+"/health")).status).toBe(200);
    expect((await fetch(base+"/v1/media/probe",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})).status).toBe(401);
    expect((await fetch(base+"/v1/media/probe",{method:"POST",headers:{authorization:`Bearer ${s.token}`,"content-type":"application/json"},body:"{}"})).status).toBe(400);
  });
  it("rejects oversized request bodies before JSON parsing",async()=>{
    const s=await createHelperServer({maxBodyBytes:32}); opened.push(s);
    const response=await fetch(`http://127.0.0.1:${s.port}/v1/media/probe`,{method:"POST",headers:{authorization:`Bearer ${s.token}`,"content-type":"application/json"},body:JSON.stringify({path:"x".repeat(128)})});
    expect(response.status).toBe(413);
  });
});
