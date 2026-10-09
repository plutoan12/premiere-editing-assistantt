# @pea/audio

Offline Audio Engine for the Premiere Editing Assistant platform. Uses public
`@pea/core` contracts. This is an engine package, not an installable Premiere plugin.

## Capabilities

| Area | API | Behavior |
| --- | --- | --- |
| Dialogue | `analyzeDialogue(pcm, transcript, gain?)` | Intersect transcript segments with decoded PCM and measure each interval; optional gain proposal |
| Noise cleanup | `runAudioJob(request, provider, options)` | Validate and orchestrate an injected `cleanup` capability |
| BGM/ducking | `buildDuckingEnvelope(request)` | Sequence-time linear-dB gain points targeted by clip and media ID |
| Beat detection | `detectBeats(pcm, options?)` | Energy onsets; BPM only for at least four reasonably periodic onsets |
| Loudness | `measureSampleLevels`, `proposeNormalization`, provider `measureLoudness` | Native RMS/sample peak, provider LUFS/true peak and constant-gain proposals |

## Ducking example

```ts
import { buildDuckingEnvelope, serializeAudioDecision } from "@pea/audio";

const decision = buildDuckingEnvelope({
  id: "duck-1",
  clipId: "bgm-clip-1",
  mediaAssetId: "music-1",
  sampleRate: 48000,
  range: { start: 0n, end: 480000n },
  dialogue: [{ start: 96000n, end: 240000n }],
  amountDb: -12,
  attackSamples: 4800n,
  holdSamples: 2400n,
  releaseSamples: 9600n,
});
const json = serializeAudioDecision(decision);
```

All intervals above are sequence samples, not raw source offsets. They are
half-open. Map trimmed/retimed source positions with `sourceToSequenceTime` first,
then explicitly choose sample rounding with `timeToSamples` if necessary. Core
rational timestamps are preserved and bigint wire ticks use decimal strings.
`parseAudioDecision` validates the version, attenuation, ordered points and range.

Overlapping attack/hold/release supports merge into one duck to avoid pumping.
If the music starts or ends inside a ramp, the boundary point keeps the ramp gain.
Proposals do not replace manual edits; the app/adapter chooses whether to apply one.

## PCM and analysis

`PcmInput` contains `mediaAssetId`, `fingerprint`, `sampleRate`, `startSample` and
equal-length `Float32Array` channels. Supply decoded source samples; no decoder or
filesystem access is included. Empty buffers and digital silence have null levels.
Channels are squared separately before energy aggregation, avoiding phase cancellation.
The engine reads these buffers synchronously and never changes them.

Dialogue is anchored by a supplied Core Transcript, not inferred from energy.
An optional RMS target is constrained by the supplied positive-gain budget and
sample-peak ceiling; it does not promise true-peak safety or perceptual loudness.
Beat detection has configurable hop resolution, amplitude thresholds and BPM bounds.
It is suitable for clear periodic transients; irregular/sustained/short signals
return no BPM. Periodicity is a heuristic consistency score, not a probability.

## Providers and jobs

`AudioProvider` supplies an id/version plus optional `cleanup` and/or
`measureLoudness` methods. The engine package performs no filesystem or network access. The
workspace native helper supplies a real FFmpeg loudness provider; see
[its integration contract](../../apps/native-helper/README.md#audio-dsp-jobs-and-audio-engine-integration).
Requests carry a Core read-only MediaAsset, exact source range, sample rate,
channel count, optional explicit channel layout, job/artifact IDs, artifact version
and retry attempt. When a layout is known, cleanup must return the same labels in
the same order; omission and reordering are rejected. Without layout metadata only
the channel count is verified, and the provider must preserve the source order.

- `cleanup(source, { strength }, signal, candidate)` must write to its own **new**
  derivative resource, use `candidate.artifactId` to avoid overwriting another
  result, and never modify the source. It returns URI, sample count/rate, channel
  count and `residualLatencySamples: 0n` after its own latency compensation.
- `measureLoudness(source, signal)` returns finite `integratedLufs` and
  `truePeakDbtp`, or null when unavailable. Both null denotes digital silence;
  null LUFS with a finite peak is gated/unmeasurable, not silence.
- `options.isCurrent()` must compare source/selection/settings revisions held by
  the app. It is checked before cache reuse and immediately before promotion.
- `options.signal` enables prompt cancellation even if a provider ignores it.
  A late provider may still finish its external work; the engine will not promote
  the result. Provider adapters own cleanup of abandoned derivative resources.
- `options.previous` retains a valid artifact when a new candidate fails. Retried
  jobs need a new artifact ID. Core status transitions are enforced, including
  validation failures transitioning through running to failed.
- `AudioCache` stores validated result snapshots in memory. Keys cover operation,
  engine/schema and provider versions, source identity/fingerprint/URI/range,
  sample format and settings. Persistent caches must check derivative existence.

The runner accepts absolute local `file:` URIs. It rejects lexical aliases of the
source and fresh outputs that reuse the previous derivative. Case and Unicode
normalization checks are conservative. Filesystem aliases/symlinks and actual
output contents remain the provider adapter's responsibility; this package does
not read or write files. Separate jobs permit partial success across inputs.

`proposeNormalization(measurement, target)` requires an explicit target LUFS,
true-peak ceiling and maximum positive gain. If headroom prevents the target it
returns the smaller gain and `targetReached: false`. It does not add a limiter.
Without a true-peak reading it returns unsupported, not a supposedly safe gain.

## Verification

From the workspace root:

```sh
pnpm --filter @pea/audio test
pnpm --filter @pea/audio typecheck
pnpm test
pnpm typecheck
```

Tests use tiny synthetic PCM and provider doubles. These verify deterministic
signal/time/decision logic, contracts, cancellation, staleness, caches and artifact
promotion. They do not verify actual denoising quality, standards-compliant LUFS/
true-peak measurement, listening quality, decoding, performance on production media,
real-time preview, or Premiere application. Those require reference fixtures, listening review and host acceptance. The helper integration suite
adds actual FFmpeg measurement/rendering checks; it does not certify standards
compliance. No build or lint command exists in this baseline.
