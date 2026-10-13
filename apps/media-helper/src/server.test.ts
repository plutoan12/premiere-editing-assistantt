import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCatalog } from "@pea/media-organizer";
import { createMediaServer } from "./server.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pea-server-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const server = await createMediaServer({
    catalogPath: join(dir, "catalog.sqlite"),
    probe: {
      async probe() {
        return {
          mediaKind: "audio",
          duration: { ticks: 2n, timebase: { numerator: 1, denominator: 1 } },
          candidates: [],
        };
      },
    },
    providerVersion: "fixture",
  });
  cleanup.push(() => server.close());
  return {
    server,
    dir,
    post: async (route: string, input: unknown) =>
      fetch(server.baseUrl + route, {
        method: "POST",
        headers: {
          authorization: "Bearer " + server.token,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      }),
  };
}
it("requires a session token and rejects browser origins", async () => {
  const { server } = await fixture();
  expect((await fetch(server.baseUrl + "/catalog")).status).toBe(401);
  expect(
    (
      await fetch(server.baseUrl + "/catalog", {
        headers: {
          authorization: "Bearer " + server.token,
          origin: "https://example.com",
        },
      })
    ).status,
  ).toBe(403);
});
it("registers real bytes once, persists metadata, and returns resumable snapshots", async () => {
  const { post, dir } = await fixture(),
    path = join(dir, "source.wav");
  await writeFile(path, "source bytes");
  const first = await post("/ingest", { paths: [path] });
  expect(first.status).toBe(200);
  const result = (await first.json()) as any,
    state = importCatalog(result.catalog);
  expect(state.assets).toHaveLength(1);
  expect(result.result.items[0].state).toBe("registered");
  const id = state.assets[0].asset.id;
  const edit = await post("/metadata", {
    assetId: id,
    field: "deviceId",
    value: "Camera A",
    revision: state.revision,
  });
  expect(edit.status).toBe(200);
  const second = (await (
      await post("/ingest", { paths: [path] })
    ).json()) as any,
    next = importCatalog(second.catalog);
  expect(next.assets).toHaveLength(1);
  expect(next.assets[0].asset.id).toBe(id);
  expect(second.result.items[0].state).toBe("unchanged");
  expect(next.metadata.some((row) => row.override?.value === "Camera A")).toBe(
    true,
  );
  const stale = await post("/metadata", {
    assetId: id,
    field: "deviceId",
    value: "Wrong",
    revision: state.revision,
  });
  expect(stale.status).toBe(409);
});
it("rejects malformed paths and oversized request lists before scanning", async () => {
  const { post } = await fixture();
  expect((await post("/ingest", { paths: ["relative.mov"] })).status).toBe(400);
  expect(
    (await post("/ingest", { paths: Array(501).fill("/tmp/a.mov") })).status,
  ).toBe(400);
});
it("cancels an in-flight scan, rejects concurrent writes and retains completed work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pea-cancel-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  let ready!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const server = await createMediaServer({
    catalogPath: join(dir, "catalog.sqlite"),
    providerVersion: "slow",
    probe: {
      async probe(_input, ctx) {
        ready();
        await new Promise((_resolve, reject) =>
          ctx?.signal?.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
        throw new Error("unreachable");
      },
    },
  });
  cleanup.push(() => server.close());
  const post = (route: string, input: unknown) =>
    fetch(server.baseUrl + route, {
      method: "POST",
      headers: {
        authorization: "Bearer " + server.token,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
  const path = join(dir, "source.wav");
  await writeFile(path, "bytes");
  const request = post("/ingest", { paths: [path] });
  await entered;
  expect((await post("/ingest", { paths: [path] })).status).toBe(409);
  expect((await post("/cancel", {})).status).toBe(200);
  const result = (await (await request).json()) as any;
  expect(result.result.job.status).toBe("cancelled");
  expect(result.result.items[0].state).toBe("cancelled");
  expect(importCatalog(result.catalog).assets).toHaveLength(0);
});
it("rejects impossible dates without committing a locked override", async () => {
  const { post, dir } = await fixture(),
    path = join(dir, "source.wav");
  await writeFile(path, "bytes");
  const state = importCatalog(
    ((await (await post("/ingest", { paths: [path] })).json()) as any).catalog,
  );
  expect(
    (
      await post("/metadata", {
        assetId: state.assets[0].asset.id,
        field: "captureDate",
        value: "2026-02-31",
        revision: state.revision,
      })
    ).status,
  ).toBe(400);
});
it("marks interrupted jobs retryable when reopening without replacing completed assets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pea-recovery-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "catalog.sqlite");
  const { openCatalog } = await import("./sqlite-store.js");
  const { randomUUID } = await import("node:crypto");
  const store = openCatalog(path),
    state = await store.read();
  state.jobs.push({
    job: {
      id: randomUUID(),
      kind: "media-ingest",
      status: "running",
      attempt: 0,
    },
    items: [],
  });
  const saved = await store.commit(state.revision, state);
  store.close();
  const server = await createMediaServer({
    catalogPath: path,
    providerVersion: "test",
    probe: {
      async probe() {
        throw new Error("unused");
      },
    },
  });
  cleanup.push(() => server.close());
  const response = await fetch(server.baseUrl + "/catalog", {
    headers: { authorization: "Bearer " + server.token },
  });
  const restored = importCatalog(((await response.json()) as any).catalog);
  expect(restored.catalogId).toBe(saved.catalogId);
  expect(restored.jobs[0].job.status).toBe("failed");
  expect(restored.jobs[0].job.error).toContain("INTERRUPTED");
});
it("blocks interrupted rescans until content is verified again and preserves user edits", async () => {
  const { server, dir, post } = await fixture(),
    path = join(dir, "original.wav");
  await writeFile(path, "before");
  const initial = importCatalog(
    ((await (await post("/ingest", { paths: [path] })).json()) as any).catalog,
  );
  await server.close();
  const { openCatalog } = await import("./sqlite-store.js"),
    { randomUUID } = await import("node:crypto");
  const { setMetadataOverride, buildOrganizationPlan, defaultRuleSet } =
    await import("@pea/media-organizer");
  const store = openCatalog(join(dir, "catalog.sqlite"));
  let state = await store.read();
  const id = state.assets[0].asset.id;
  state = setMetadataOverride(
    state,
    { kind: "asset", id },
    "deviceId",
    "My Camera",
  );
  state.scans[0].state = "running";
  state.scans[0].step = "reading";
  state.jobs.push({
    job: {
      id: randomUUID(),
      kind: "media-ingest",
      status: "running",
      attempt: 0,
    },
    items: [],
  });
  await store.commit(state.revision, state);
  store.close();
  await writeFile(path, "after replacement");
  const options = {
    catalogPath: join(dir, "catalog.sqlite"),
    providerVersion: "fixture",
    probe: {
      async probe() {
        return {
          mediaKind: "audio",
          duration: { ticks: 2n, timebase: { numerator: 1, denominator: 1 } },
          candidates: [],
        };
      },
    },
  };
  const reopened = await createMediaServer(options);
  cleanup.push(() => reopened.close());
  const headers = {
    authorization: "Bearer " + reopened.token,
    "content-type": "application/json",
  };
  const recovered = importCatalog(
    (
      (await (
        await fetch(reopened.baseUrl + "/catalog", { headers })
      ).json()) as any
    ).catalog,
  );
  const rules = defaultRuleSet(randomUUID());
  rules.orderedFields = ["mediaKind"];
  const plan = buildOrganizationPlan(
    recovered,
    [{ kind: "asset", id }],
    rules,
    [],
    randomUUID,
  );
  expect(plan.assignments).toHaveLength(0);
  expect(plan.issues[0].code).toBe("source_unverified");
  expect(recovered.scans[0].state).toBe("failed");
  expect(recovered.assets[0].analysis).toEqual(initial.assets[0].analysis);
  const retried = (await (
    await fetch(reopened.baseUrl + "/ingest", {
      method: "POST",
      headers,
      body: JSON.stringify({ paths: [path] }),
    })
  ).json()) as any;
  const after = importCatalog(retried.catalog);
  expect(retried.result.items[0].state).toBe("updated");
  expect(after.assets[0].asset.id).toBe(id);
  expect(after.assets[0].sourceState).toBe("verified");
  expect(after.metadata.some((m) => m.override?.value === "My Camera")).toBe(
    true,
  );
});
it("verifies the reviewed source bytes without revising the catalog and blocks replacements", async () => {
  const { post, dir } = await fixture(),
    path = join(dir, "source.mov");
  await writeFile(path, "original bytes");
  const state = importCatalog(
    ((await (await post("/ingest", { paths: [path] })).json()) as any).catalog,
  );
  const input = {
    revision: state.revision,
    sources: [{ assetId: state.assets[0].asset.id, path }],
  };
  expect((await post("/verify-sources", input)).status).toBe(200);
  expect(
    (await post("/verify-sources", { ...input, revision: state.revision - 1 }))
      .status,
  ).toBe(409);
  await writeFile(path, "different bytes");
  expect((await post("/verify-sources", input)).status).toBe(409);
  expect(
    (
      await post("/verify-sources", {
        ...input,
        sources: [
          {
            assetId: state.assets[0].asset.id,
            path: join(dir, "unregistered.mov"),
          },
        ],
      })
    ).status,
  ).toBe(409);
});
