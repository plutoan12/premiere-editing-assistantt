import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  importCatalog,
  createSearchIndex,
  classify,
  defaultRuleSet,
} from "@pea/media-organizer";
import { runProcess } from "./vendor/process-runner.js";
import { createProbe } from "./providers.js";
import { createMediaServer } from "./server.js";
const root = process.env.PEA_MEDIA_VALIDATION_DIR
  ? resolve(process.env.PEA_MEDIA_VALIDATION_DIR)
  : await mkdtemp(join(tmpdir(), "pea-media-validation-"));
await mkdir(join(root, "sources"), { recursive: true });
const ffmpeg = process.env.PEA_FFMPEG_PATH ?? "ffmpeg",
  ffprobe = process.env.PEA_FFPROBE_PATH ?? "ffprobe";
const paths: string[] = [];
for (let i = 0; i < 20; i++) {
  const path = join(
    root,
    "sources",
    `샘플_${String(i + 1).padStart(2, "0")}.${i < 10 ? "mov" : "wav"}`,
  );
  paths.push(path);
  await runProcess(
    ffmpeg,
    [
      "-v",
      "error",
      "-n",
      "-f",
      "lavfi",
      "-i",
      i < 10
        ? "testsrc2=size=160x90:rate=25"
        : "sine=frequency=440:sample_rate=48000",
      "-t",
      "0.4",
      ...(i < 10
        ? [
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-metadata",
            "creation_time=2026-10-13T03:00:00Z",
          ]
        : ["-c:a", "pcm_s16le"]),
      path,
    ],
    { timeoutMs: 30000 },
  );
}
const digest = async (path: string) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  before = await Promise.all(paths.map(digest));
const { probe, version } = await createProbe(ffprobe),
  options = {
    catalogPath: join(root, "catalog.sqlite"),
    probe,
    providerVersion: version,
  };
let server = await createMediaServer(options);
const call = async (route: string, input?: unknown) => {
  const r = await fetch(server.baseUrl + route, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer " + server.token,
      "content-type": "application/json",
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json() as Promise<any>;
};
try {
  const first = await call("/ingest", { paths }),
    state = importCatalog(first.catalog);
  assert.equal(state.assets.length, 20);
  assert.ok(first.result.items.every((i: any) => i.state === "registered"));
  const assetId = state.assets[0].asset.id;
  await call("/metadata", {
    assetId,
    field: "deviceId",
    value: "Camera A",
    revision: state.revision,
  });
  const revision = (await call("/catalog")).catalog;
  const saved = importCatalog(revision);
  await server.close();
  server = await createMediaServer(options);
  assert.deepEqual(importCatalog((await call("/catalog")).catalog), saved);
  const second = await call("/ingest", { paths });
  assert.ok(second.result.items.every((i: any) => i.state === "unchanged"));
  const restored = importCatalog(second.catalog);
  const index = createSearchIndex();
  await index.rebuild(restored);
  assert.ok(
    index
      .search({ text: "Camera A", filters: {} })
      .some((hit) => hit.mediaAssetId === assetId),
  );
  const result = classify(
    { kind: "asset", id: assetId },
    restored,
    defaultRuleSet("557d00b1-30ec-424e-bb54-d8c8891c120f"),
  );
  assert.deepEqual(result.pathSegments, [
    "Media Organizer",
    "2026-10-13",
    "Camera A",
    "Video",
  ]);
  const corrupt = join(root, "sources", "broken.mov");
  await writeFile(corrupt, "not media");
  const failure = await call("/ingest", { paths: [corrupt] });
  assert.equal(failure.result.items[0].state, "failed");
  assert.equal(importCatalog(failure.catalog).assets.length, 20);
  assert.deepEqual(await Promise.all(paths.map(digest)), before);
  const cover = join(root, "cover.jpg"),
    song = join(root, "album.mp3");
  await runProcess(
    ffmpeg,
    [
      "-v",
      "error",
      "-n",
      "-f",
      "lavfi",
      "-i",
      "color=red:size=64x64",
      "-frames:v",
      "1",
      cover,
    ],
    { timeoutMs: 30000 },
  );
  await runProcess(
    ffmpeg,
    [
      "-v",
      "error",
      "-n",
      "-i",
      paths[10],
      "-i",
      cover,
      "-map",
      "0:a",
      "-map",
      "1:v",
      "-c:a",
      "libmp3lame",
      "-c:v",
      "copy",
      "-disposition:v:0",
      "attached_pic",
      song,
    ],
    { timeoutMs: 30000 },
  );
  const songHash = await digest(song),
    music = await call("/ingest", { paths: [song] });
  const musicAsset = importCatalog(music.catalog).assets.find(
    (a) => a.asset.id === music.result.items[0].assetId,
  );
  assert.equal(musicAsset?.probe?.mediaKind, "audio");
  assert.equal(await digest(song), songHash);
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        runtime: process.version,
        ffprobe: version,
        files: 20,
        video: 10,
        audio: 10,
        reopenedCatalog: true,
        stableIds: true,
        preservedOverride: true,
        search: true,
        classification: result.pathSegments,
        corruptRejected: true,
        attachedArtworkClassifiedAudio: true,
        sourceHashesUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: 20 real files, restart, stable IDs, override, search, classification, corrupt media and source hashes. Report: " +
      join(root, "report.json"),
  );
} finally {
  await server.close();
}
