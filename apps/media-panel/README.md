# Media Organizer development runtime

Premiere 26.5+ UXP panel for real file registration, SQLite restore, filename/metadata search and date/device classification preview. The reusable engine remains in `@pea/media-organizer`; only `src/premiere.ts` reads Adobe objects. Other editors can use the same helper and engine contracts.

## Run

Requires Node 22.16+ (validated on 24.18.1), pnpm 10.17.1, an installed `ffprobe`, Premiere Pro 26.5+, and Adobe UXP Developer Tools. ffprobe is invoked read-only and is not redistributed here. Node's `node:sqlite` API is experimental in the supported Node 22/24 runtime.

From the repository root:

```sh
npx --yes pnpm@10.17.1 install --frozen-lockfile
npx --yes pnpm@10.17.1 --filter @pea/media-panel build
PEA_FFPROBE_PATH=/absolute/path/to/ffprobe npx --yes pnpm@10.17.1 --filter @pea/media-helper start
```

1. Add `dist/media-organizer/manifest.json` to UXP Developer Tools and load it into Premiere.
2. Click **로컬 엔진 연결** and select the `connection.json` path printed by the helper.
3. Choose media with **파일 선택해 등록**, or select original project items in Premiere and use **Premiere 선택 소스 등록**. Sequences, folders and offline clips are skipped. Subclip In/Out and host item bindings are not imported: this stage registers original full files.
4. Search, choose a file, and confirm its capture date/device. Blank fields preserve existing values. Missing or uncertain metadata remains a review item.
5. Restart the helper, reconnect with its new connection file, and read the saved catalog.

The helper stores its catalog under `~/.pea/media-organizer`. Set `PEA_MEDIA_STATE_DIR` to use a separate test/catalog directory. A single helper owns a state directory; it creates the connection file exclusively with owner-only permissions. Ctrl-C stops it and removes only its own connection file. After an abnormal process termination, confirm that its helper is stopped and remove only that directory's stale `connection.json` before starting again. Keep `catalog.sqlite`, `catalog.sqlite-wal` and `catalog.sqlite-shm` intact. A stale connection file is never silently overwritten.

## Boundary and limits

- Development runtime, not a distributable installer. No Bin/timeline/source/XMP writes or automatic imports into Premiere. No global filesystem scan.
- Loopback listener, random bearer token per run, no browser CORS grants. Do not share the connection file. User-selected paths go only to the local helper.
- Full SHA-256 reads in 1 MiB chunks; stamp checks bracket ingest. ffprobe supplies format duration, nominal frame rate, dimensions and creation-time observations. CFR/VFR cadence is **unverified**; no false `variableFrameRate: false` is inferred. Physical camera identity is user-confirmed, not guessed from model or filename.
- One writer per helper; optimistic revisions reject stale metadata saves. Ingest cancellation keeps completed item commits. SQLite WAL/FULL stores versioned validated snapshots; unknown/corrupt catalogs fail closed. Interrupted jobs become retryable failures on reopening.
- Entire catalog snapshots are serialized each commit. Large-library throughput, disk-full recovery, schema migrations, backup UI, Windows/macOS packaging, persistent project IDs across Save As, source monitor, thumbnails and real Bin apply/Undo still require follow-up work.

## Validation

```sh
npx --yes pnpm@10.17.1 test
npx --yes pnpm@10.17.1 typecheck
PEA_FFMPEG_PATH=/absolute/path/to/ffmpeg PEA_FFPROBE_PATH=/absolute/path/to/ffprobe \
  npx --yes pnpm@10.17.1 --filter @pea/media-helper validate:media
```

The real-media command generates a fresh temporary directory (or uses a fresh `PEA_MEDIA_VALIDATION_DIR`), 10 small H.264 MOVs and 10 PCM WAVs. It checks registration, restart, IDs, overrides, search/classification, corrupt media, and unchanged source hashes, and writes `report.json`. It does not operate Premiere. See the [actual runtime observations](../../docs/research/2026-10-13-media-organizer-runtime.md) for the separate host test.

## Reuse

The panel build, connection file, selection/readback and helper lifecycle patterns are adapted from this repository's Sync implementation. `apps/media-helper/src/vendor/process-runner.ts` is copied unchanged from `apps/native-helper/src/process-runner.ts` at `e9e1c4c1345630ec9d859164a0859866177d998c`. It remains local until the corresponding branches integrate, avoiding a dependency on the full Sync/multicam stack. The engine, exact-time catalog codec, ingest, MiniSearch and classification are imported rather than copied.
