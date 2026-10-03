# @pea/native-helper

Development helper for the approved local Premiere pipeline. No required cloud service,
paid AI API, source-media writes, or automatic executable downloads. This is **not**
a packaged macOS application or an installed Premiere UXP plugin.

## Run

Use Node 22 and pnpm. Install FFmpeg and ffprobe separately, then from the repository:

```sh
pnpm install
pnpm --filter @pea/native-helper start
```

The command prints one JSON `ready` event with `sessionFile`. The file contains
`address`, `sessionToken` and `protocolVersion`. It is mode 0600 inside a private
0700 temporary directory. Read it from the local native client, not a website.
The token is never printed or returned by `/health`. Ctrl+C or SIGTERM closes the
helper and removes only its session file. Other files in that directory are preserved.
`PEA_FFMPEG_PATH` and `PEA_FFPROBE_PATH` optionally select installed executables.
`tsx` is a pinned development launcher, not a paid service or production bundle.

## HTTP protocol v1

Bind is always `127.0.0.1` on an ephemeral port. `/v1/*` requires
`Authorization: Bearer <sessionToken>`. Send JSON with `Content-Type: application/json`.
A supplied `X-PEA-Protocol-Version` must be `1`. Browser Origin headers and nonlocal
Host headers are rejected. No wildcard CORS is enabled. UXP's actual request headers
and bootstrap integration still require verification inside Premiere.

| Method / path | Request or response |
| --- | --- |
| GET `/health` | Public status, protocol and helper version; no token |
| GET `/v1/ping` | Authenticated handshake |
| POST `/v1/media/probe` | `{ "path": "/absolute/source.mov" }` |
| POST `/v1/audio/window` | `{ "path": "/absolute/source.mov", "startSample": "0", "maxSamples": 16000, "sampleRate": 8000 }` |
| POST `/v1/jobs` | `{ "kind": "audio-window", "input": { "path": "/absolute/source.mov", "startSample": "0", "maxSamples": 16000 } }` or kind `media-probe` with its probe input |
| GET `/v1/jobs/:id` | State and metadata; never a PCM array in JSON |
| GET `/v1/jobs/:id/audio` | Authenticated binary result of a completed audio job |
| POST `/v1/jobs/:id/cancel` | Idempotent cancellation; finished jobs return 409 |
| DELETE `/v1/jobs/:id` | 204 after cleanup; running/unfinished cleanup returns 409 |

PCM responses are `application/octet-stream`, **mono f32le**, with
`X-PEA-Format`, `X-PEA-Sample-Rate`, `X-PEA-Start-Sample`, `X-PEA-Sample-Count`
and `X-PEA-Content-SHA256`. Read float32 little-endian explicitly. `startSample` is
a decimal string on the wire and bigint in the provider. Apply the returned sample
rate when interpreting its units. Polling a job returns an `audioUrl`, not sample data.

## Bounds and failure behavior

- JSON bodies: 65536 bytes. PCM: 1..262144 samples, at most 1 MiB per window.
- At most 2 concurrent media operations and 16 retained in-memory jobs. Delete
  terminal jobs to reclaim capacity. Jobs/artifacts do not survive restart.
- FFprobe has a 10-second timeout; decode has a 30-second timeout by default.
- Pre-cancelled work never spawns. Timeout/cancellation kills the child and waits
  for its `close` event. Late cancelled results are never promoted.
- Only existing absolute regular local files are accepted. Protocol and demuxer
  allowlists exclude remote inputs and playlists. This is not a sandbox against
  other programs running as the same operating-system user or a hardened decoder VM.
- Tool stderr and sensitive paths are not included in HTTP error messages.
- No-audio, corrupt media, empty/EOF windows and invalid PCM are explicit errors.
- Declared nonzero audio-vs-container start offsets are rejected until a timeline
  mapping policy is supplied. Timestamp discontinuities and recording drift are not corrected.

## Exact window policy

Decoder version `ffmpeg-local/2` downmixes/resamples from decoded origin with
`async=0`, then uses `atrim` sample counts. This avoids the filter-state mismatch
observed when seeking to a later point before resampling. Late windows may be
slower or time out because this correctness-first version traverses earlier audio.
It is bounded-memory, not a finished long-recording window scheduler.

## Verification

```sh
pnpm --filter @pea/native-helper test
pnpm --filter @pea/native-helper typecheck
pnpm test
pnpm typecheck
```

**FFmpeg and ffprobe are required for the integration suite. Missing executables
fail the suite instead of silently skipping it.** CI installs them first.
Generated WAV and MOV/PCM fixtures test real probing/decoding, resampling continuity,
signed known offsets, differing window origins, HTTP audio jobs and source immutability.
They do not measure real production-footage accuracy or all camera codecs.

Remaining release gates: permitted camera/recorder footage, macOS execution,
Premiere UXP handshake/adapter, disposable-project Apply, and signed installation.
