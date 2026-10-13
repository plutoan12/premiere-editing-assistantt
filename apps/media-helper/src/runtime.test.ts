import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { emptyCatalog, defaultRuleSet } from "@pea/media-organizer";
import { openCatalog } from "./sqlite-store.js";
import { createFiles, normalizeProbe } from "./providers.js";
const dirs: string[] = [];
async function directory() {
  const d = await mkdtemp(join(tmpdir(), "pea-media-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
describe("durable catalog", () => {
  it("restores identity and rejects stale commits across connections", async () => {
    const path = join(await directory(), "catalog.sqlite"),
      a = openCatalog(path),
      initial = await a.read();
    initial.ruleSets.push(defaultRuleSet(randomUUID()));
    const saved = await a.commit(initial.revision, initial);
    a.close();
    const b = openCatalog(path),
      c = openCatalog(path);
    try {
      expect(await b.read()).toEqual(saved);
      await b.commit(saved.revision, saved);
      await expect(c.commit(saved.revision, saved)).rejects.toThrow(/revision/);
    } finally {
      b.close();
      c.close();
    }
  });
  it("invalid writes leave the prior catalog intact", async () => {
    const store = openCatalog(join(await directory(), "catalog.sqlite")),
      before = await store.read();
    try {
      await expect(
        store.commit(before.revision, { ...before, catalogId: randomUUID() }),
      ).rejects.toThrow(/identity/);
      expect(await store.read()).toEqual(before);
    } finally {
      store.close();
    }
  });
  it("refuses future schema without changing the database", async () => {
    const path = join(await directory(), "future.sqlite"),
      db = new DatabaseSync(path);
    db.exec("PRAGMA user_version=99");
    db.close();
    const before = await readFile(path);
    expect(() => openCatalog(path)).toThrow(/schema/);
    expect(await readFile(path)).toEqual(before);
  });
  it("does not replace corrupted stored data with an empty catalog", async () => {
    const path = join(await directory(), "bad.sqlite"),
      store = openCatalog(path);
    store.close();
    const db = new DatabaseSync(path);
    db.exec("UPDATE catalog SET document='broken'");
    db.close();
    expect(() => openCatalog(path)).toThrow();
  });
});
describe("source providers", () => {
  it("hashes all bytes, preserves originals, and supports cancellation", async () => {
    const path = join(await directory(), "한글 # file.bin"),
      bytes = Buffer.alloc(3 * 1024 * 1024 + 37, 19);
    await writeFile(path, bytes);
    const uri = pathToFileURL(path).href,
      files = createFiles();
    expect(await files.sha256(uri)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(await readFile(path)).toEqual(bytes);
    await expect(
      files.sha256(uri, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect((await files.stat(uri)).size).toBe(BigInt(bytes.length));
  });
  it("rejects network and non-file sources", async () => {
    await expect(
      createFiles().stat("https://example.com/movie.mov"),
    ).rejects.toThrow();
  });
  it("keeps exact duration, rate and dated observations without inventing CFR", () => {
    const record = normalizeProbe(
      {
        format: {
          duration: "1.001000",
          tags: { creation_time: "2026-10-13T00:00:00Z" },
        },
        streams: [
          {
            codec_type: "video",
            width: 320,
            height: 180,
            avg_frame_rate: "30000/1001",
          },
        ],
      },
      "test",
    );
    expect(record.duration).toEqual({
      ticks: 1001000n,
      timebase: { numerator: 1, denominator: 1000000 },
    });
    expect(record.frameRate?.rate).toEqual({
      numerator: 30000,
      denominator: 1001,
    });
    expect(record.variableFrameRate).toBeUndefined();
    expect(record.candidates[0]).toMatchObject({
      field: "captureDate",
      value: "2026-10-13",
      timezone: "Z",
    });
  });
  it("rejects corrupt metadata and keeps timezone uncertainty", () => {
    expect(() => normalizeProbe({ streams: [] }, "test")).toThrow();
    const p = normalizeProbe(
      {
        format: {
          duration: "2",
          tags: { creation_time: "2026-10-13 12:00:00" },
        },
        streams: [{ codec_type: "audio", channels: 2 }],
      },
      "test",
    );
    expect(p.candidates[0].timezone).toBeUndefined();
  });
});
it("SQLite rolls back an interrupted transaction and retains the previous committed snapshot", async () => {
  const path = join(await directory(), "interrupted.sqlite"),
    store = openCatalog(path),
    before = await store.read();
  store.close();
  const { spawnSync } = await import("node:child_process");
  const child = spawnSync(process.execPath, [
    "-e",
    "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec(\"BEGIN IMMEDIATE; UPDATE catalog SET document='interrupted'\");process.exit(17)",
    path,
  ]);
  expect(child.status).toBe(17);
  const reopened = openCatalog(path);
  try {
    expect(await reopened.read()).toEqual(before);
  } finally {
    reopened.close();
  }
});
