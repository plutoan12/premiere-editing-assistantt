# @pea/native-helper

Development-stage local service for the consolidated Sync API. This package does
not include a Premiere UXP panel, a signed macOS application, or FFmpeg binaries.
It requires Node 22 and a user-installed FFmpeg/ffprobe on macOS or Linux. No cloud
service, API key, model call, executable download, or source-media write is used.

## Run

From the repository root:

```sh
pnpm install --no-frozen-lockfile
pnpm --filter @pea/native-helper build
node packages/native-helper/dist/pea-helper.mjs --check
node packages/native-helper/dist/pea-helper.mjs --media-root "$HOME/Movies"
```

Use an existing absolute folder; repeat `--media-root` to approve another folder.
`PEA_FFMPEG` and `PEA_FFPROBE` may specify trusted installed executables when the
launcher's PATH differs from a terminal. Executable paths are never HTTP inputs.

The launcher prints one JSON line containing `url` and `sessionFile`, **not** the
token. The session file is created in a private random directory (0700), with file
mode 0600. Read its `token` field in the local client. The token rotates each run.
SIGINT/SIGTERM shuts down jobs/processes and removes only the owned session file.
A force kill can leave a stale private session file; it does not reactivate a token.

## HTTP protocol v1

Bind address is always `127.0.0.1` and the port is selected by the OS. The client
uses the session file's URL and sends these headers on all `/v1` operations:

```text
Authorization: Bearer <session-file-token>
X-PEA-Protocol: 1
Content-Type: application/json
```

`GET /health` returns only versions and implemented capability names. It does not
return a token, file list, media paths, or proof that Premiere is installed.

| Method / path | Body / output |
| --- | --- |
| POST /v1/media/probe | `{ "path": "/approved/folder/take.mov" }` -> opaque asset ID and normalized metadata |
| POST /v1/audio/window | `{ "assetId": "...", "window": { ... } }` -> binary little-endian Float32 mono PCM |
| POST /v1/jobs | Sync request below -> 202 and queued job ID |
| GET /v1/jobs/:id | Job status/progress, result, or structured error |
| POST /v1/jobs/:id/cancel | Idempotent cancellation |
| DELETE /v1/jobs/:id | Delete terminal job result only; never media |

A window contains `sampleRate` (8000, 16000, or 48000; default 8000),
`startSample` (decimal string, default `"0"`), `sampleCount` (16..262144; default
80000), optional absolute audio `stream` index, and `channel` (default 0).
The chosen channel is retained, not implicitly downmixed with other channels.
Resampling is explicit and recorded. Requests extending beyond EOF fail rather
than padding samples or pretending there is more audio.

Binary responses expose `X-PEA-Sample-Rate`, `X-PEA-Start-Sample`,
`X-PEA-Sample-Count`, `X-PEA-PCM-SHA256`, `X-PEA-Stream`, and `X-PEA-Channel`.
Decode the body as little-endian floats. PCM is never an unbounded JSON array.

Example job after probing each file:

```json
{
  "kind": "sync",
  "referenceClipId": "camera-a",
  "clips": [
    { "clipId": "camera-a", "assetId": "returned-id-a", "window": { "sampleCount": 80000 } },
    { "clipId": "recorder", "assetId": "returned-id-b", "window": { "sampleCount": 80000 } }
  ]
}
```

Up to 16 clips, unique clip IDs, one selected reference, one rate shared by all
analysis windows. Optional `maxLagSamples` and `minOverlapSamples` bound the search.
This helper endpoint uses **audio evidence only**: it does not infer a shared jam
clock from metadata or reuse camera recording timecode for music playback.

Job `completed` means analysis finished, not that every clip matched. Check
`result.group.status` (`matched`, `partial`, `review`) and each candidate. An
unreliable match never becomes an accepted placement. All bigint time fields are
decimal strings over HTTP; their rational timebase travels with them.

## Security and resource boundaries

Only explicit media roots are allowed. Paths are canonicalized and checked for
escape; symlinks outside the roots and non-regular files are rejected. Files are
opened read-only and passed as an inherited descriptor via `/dev/fd/3`. The engine
never owns a file path. Revision checks before/after processing reject changed
media. `revisionKind: stat-v1` is a stat identity hash, **not** a full file hash;
`pcmSha256` hashes the actual decoded analysis bytes.

FFmpeg is invoked with fixed arguments, no shell, a demuxer allowlist, and no
network protocol. Playlist/concat inputs are not accepted. Supported demuxers are
WAV, MOV/MP4, Matroska/WebM, MP3, FLAC, Ogg, AVI, MXF, and raw AAC, subject to the
installed FFmpeg build. This is not an operating-system sandbox for malicious
codec exploits: use trusted/updated binaries and permitted media.

Requests reject unexpected Host headers and browser origins. By default no browser
origin is allowed; native clients with no Origin still need the token. Embedders
may configure exact HTTP(S) origins, never `*`; an approved CORS preflight grants
no access without a bearer token on the subsequent request. UXP-specific origin
and permission acceptance remains a later integration gate.

Limits: 64 KiB JSON body, 16 active authenticated HTTP requests, two direct media
requests plus one active Sync job, 32 retained jobs, 256 registered assets, and
262144 samples per window. Terminal jobs are evicted at capacity. Media child
processes time out after 30 seconds; a Sync job times out after 120 seconds.
Cancellation sends SIGTERM then SIGKILL when needed, drains pipes, and does not
promote a late result. Pending decoders finish cleanup before a cancelled Sync job
releases its worker slot. Raw child stderr and tokens are never HTTP error text.

## Scope limits

One explicit analysis window per clip, not automatic long-file discovery. Exact
sample-order extraction currently decodes the prefix before the requested window;
far-away windows can time out. There is no silent fast-seek approximation or drift
correction. Different known audio/video stream start times are rejected pending
explicit timestamp mapping. CPU correlation is bounded but synchronous within
the helper; UI work belongs to a separate UXP process.

Registered assets/results are session-local. No persistent whole-file cache,
production-footage benchmark, OS auto-start daemon, Windows support, signed native
installer, or Premiere project mutation is included in this phase.

## Verification

```sh
pnpm --filter @pea/native-helper test
pnpm --filter @pea/native-helper test:integration
pnpm --filter @pea/native-helper typecheck
pnpm --filter @pea/native-helper build
pnpm --filter @pea/native-helper smoke
pnpm test
pnpm typecheck
```

The Native Helper workflow runs on Ubuntu and macOS. Integration tests generate
small WAV/MOV containers in temporary folders. The bundled-launcher smoke test
uses HTTP probe -> Sync -> result -> shutdown, expects exactly +500 samples, checks
that the token was not logged, and verifies session cleanup. These are generated
fixtures, not footage from the user's shoots. Distribution artifacts are Node
ESM bundles only; FFmpeg remains a separately installed prerequisite.

## Primary implementation references

- Node child-process spawn/cancellation: https://nodejs.org/download/release/latest-jod/docs/api/child_process.html
- FFmpeg protocol restrictions: https://ffmpeg.org/ffmpeg-protocols.html
- FFmpeg atrim/aresample/pan: https://ffmpeg.org/ffmpeg-filters.html
- ffprobe structured output: https://ffmpeg.org/ffprobe.html
