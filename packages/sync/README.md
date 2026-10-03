# @pea/sync

NLE-independent, deterministic-first synchronization. This is an engine library,
not yet an installable Premiere panel or a video/audio decoder.

## API

- `chooseSyncStrategy(items)`: routing hint, not a proof of synchronization.
- `buildTimecodeSyncGroup(id, items, referenceClipId?)`: exact offsets from
  compatible, trusted timecode metadata; earliest member is zero.
- `correlateAudio(reference, take, options?)`: bounded normalized waveform
  correlation with score, runner-up margin, signed lag and polarity.
- `synchronize(request)`: compatible timecode -> supplied audio provider ->
  explicit review. Returns either a complete group or reviewable candidates.
- `buildMulticamGroups(id, items)`: compatible timecode clocks and connected,
  overlapping half-open intervals; preserves camera/source/recorder identity.
- `syncPlayback(request)`: independent takes against one cached master. Always
  uses audio, never camera timecodes. One failed take does not discard others.
- `resyncArtifacts(artifacts, revisedSegments)`: exact mapping from stable source
  clip IDs/ranges to revised timeline ranges. Returns mapped/unmapped/conflicted.

```ts
import { synchronize } from '@pea/sync';

const result = await synchronize({
  id: 'interview-01',
  items: [{ clipId: 'camera-a' }, { clipId: 'recorder' }],
  provider: myAudioSampleProvider,
  signal: abortController.signal,
  correlation: { maxOffsetSamples: 80000, minOverlapSamples: 4000 },
});
if (result.status === 'synced') {
  // Submit a proposal to the NLE adapter; do not mutate source media.
  console.log(result.group.members);
} else {
  console.log(result.candidates, result.reasons);
}
```

## Exact time and evidence

`timebase = { numerator, denominator }` is **seconds per tick**, matching
`@pea/core`. Timecode inputs require `timecodeTicks` (bigint), `timebase`, and
`frameRate: { rate: { numerator, denominator }, dropFrame }`. Bare ticks are no
longer auto-accepted; the old pre-0.1 scaffold did not declare their unit.

Supported declared rates: 24, 24000/1001, 25, 30, 30000/1001, 48, 50, 60,
60000/1001. Drop-frame is accepted only for 30000/1001 and 60000/1001. The engine
accepts already-decoded timecode ticks; it does not parse LTC or SMPTE label
strings. Different rates, units, DF/NDF flags, or declared clock domains are
never silently converted. Equivalent rational representations are accepted.

Set `timecodeDomain` consistently to identify a recording day/clock/session.
Undeclared domains are a caller assertion of a shared clock, not a detected jam
sync. Midnight rollover and recorder drift are NOT inferred. Timecode confidence
1 means arithmetic on trusted metadata is exact, not that clocks were measured.

## Audio provider boundary

Implement `getSamples(clipId, { maxSamples, signal })` and return mono normalized
PCM in [-1, 1], integer `sampleRate`, and nonnegative integer `startSample`.
`startSample` is the analysis window origin within the original clip, expressed
at the returned sample rate. Both origins are included in the offset calculation.
Reference buffers are snapshotted because decoders may reuse memory.

The provider owns file access, decoding, channel choice, explicit resampling and
window selection. No FFmpeg process, network call, AI model, or NLE API is invoked
by this package. A fingerprint is only a routing/cache hint, never an alignment.

Each window is capped at 262144 samples. Large windows are rejected, not silently
truncated. FFT correlation searches every configured lag and directly rechecks
peaks. Default minimum overlap is 64 samples; real footage should use longer,
representative windows and a deliberately chosen overlap requirement. Low-energy,
low-score, equal/repeated-peak and search-boundary cases require review.

`offsetSamples > 0` means the take window starts later on the reference window's
timeline. Candidate offsets are signed; accepted group positions are normalized
against the earliest clip. Audio scores/margins are heuristics, NOT calibrated
probabilities. Audio output timebase is 1/sampleRate; downstream adapters must
explicitly choose any video-frame quantization policy.

Cancellation is checked around provider work and matching. A cancelled caller is
released even if a provider ignores its signal, but stopping the underlying I/O
is that provider's responsibility. CPU matching is synchronous and bounded; use a
worker when the host UI must remain responsive.

## Re-sync limits

Artifacts must already carry stable `clipId` and source ranges. Partial trims,
missing sources, changed playback rates and ambiguous repeated source regions
are never silently applied. Conflict candidates have `coverage: full | partial`;
only a unique full 1x mapping enters `mapped`. This does not analyze pixels, STT,
subtitle speech boundaries or dubbed-voice duration.

## Verification and remaining integration

Run `pnpm --filter @pea/sync test` and `pnpm --filter @pea/sync typecheck`, plus the
whole workspace `pnpm test` and `pnpm typecheck` before merging. Fixtures are
synthetic; they are not a real-footage accuracy benchmark.

Still separate work: concrete FFmpeg provider and long-file window scheduling,
LTC extraction, drift correction, disconnected audio-graph grouping, real
production-footage evaluation, Premiere adapter/panel and installable packaging.

Algorithm reference: https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.correlate.html
The implementation is standalone TypeScript; SciPy is not a dependency.
