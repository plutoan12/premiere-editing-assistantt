import { describe, expect, it } from "vitest";
import { createHelperClient, parseHelperBootstrap } from "./index.js";

const good = { endpoint: "https://127.0.0.1:43119", token: "a".repeat(43), protocolVersion: "1.0", helperVersion: "0.1.0" };

describe("helper bootstrap", () => {
  it("accepts only secure loopback endpoints for release use", () => {
    expect(parseHelperBootstrap(good).endpoint).toBe("https://127.0.0.1:43119");
    expect(() => parseHelperBootstrap({ ...good, endpoint: "http://127.0.0.1:43119" })).toThrow(/secure/);
    expect(() => parseHelperBootstrap({ ...good, endpoint: "https://example.com" })).toThrow(/loopback/);
  });
  it("allows explicit insecure loopback only for development", () => {
    expect(parseHelperBootstrap({ ...good, endpoint: "http://localhost:43119" }, { allowInsecureDev: true }).endpoint).toBe("http://localhost:43119");
  });
  it("rejects incompatible major versions and weak tokens", () => {
    expect(() => parseHelperBootstrap({ ...good, protocolVersion: "2.0" })).toThrow(/incompatible/);
    expect(() => parseHelperBootstrap({ ...good, token: "short" })).toThrow(/token/);
  });
});

describe("helper client", () => {
  it("sends bearer authentication without putting the token in the URL", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      seen.push({ url: input, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ status: "ok", protocolVersion: "1.0", helperVersion: "0.1.0" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = createHelperClient({ ...good, endpoint: "http://127.0.0.1:43119" }, { allowInsecureDev: true, fetchImpl });
    await client.health();
    expect(seen[0].url).not.toContain(good.token);
    expect(seen[0].auth).toBe(`Bearer ${good.token}`);
  });
});
