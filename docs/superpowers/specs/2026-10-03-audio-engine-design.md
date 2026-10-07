# Audio Engine design

Date: 2026-10-03. Scope authorized in the Audio Engine conversation.

## Baseline and boundaries

The initial main revision `ef9e541` contains only platform/Core plans. This
implementation uses the existing local `feat/core-contracts` revision `9f2119c`
in an isolated worktree. Core exists at that revision; its public `AudioDecision`
is intentionally small (id/kind/range/value). Audio adds versioned envelopes with
media identity and gain points without changing Core or its serialized formats.

The package is NLE-independent, offline and dependency-injected. It does not
decode files, write source media, call a service, or control Premiere. It produces
analysis and editing proposals. STT and speaker recognition remain Subtitle work.

## MVP

| Area | Delivered behavior | Explicit limit |
| --- | --- | --- |
| Dialogue | Measure supplied transcript intervals against decoded PCM; propose RMS gain constrained by sample peak | No speech recognition or speech/noise classifier; sample peak is not true peak |
| Noise Cleanup | Validate and run an injected cleanup capability; validate derivative URI/format/length and promote a valid artifact | No bundled denoiser; absent capability is unsupported |
| BGM/Ducking | Generate a linear-dB envelope from sequence sample intervals with attack/hold/release | No NLE writes; caller maps source intervals to sequence first |
| Beat Detection | Multi-channel energy onsets and stable-interval BPM estimation | A transient detector, not a general musical beat tracker; irregular signals retain onsets but have no BPM |
| Loudness | Exact PCM sample-peak/RMS; injected integrated-LUFS/true-peak measurement; peak-constrained normalization proposal | No unverified LUFS approximation and no limiter/rendering |

## Time, signal and envelope contracts

PCM has sample rate, media identity/fingerprint, source start sample and separate
Float32Array channels of equal length. Samples must be finite. Channel energy is
combined after squaring, so anti-phase stereo cannot disappear through downmixing.
Arrays are never edited. Empty PCM is silence. Analysis ranges are half-open.

Canonical time is Core MediaTime: integer ticks times a rational timebase. Exact
sample conversion rejects fractional samples unless floor/ceil/nearest is explicitly
requested (nearest ties round away from zero). Source-to-sequence mapping uses the
clip range, destination and positive rational speed, with exact arithmetic; source
times outside the clip are rejected. No frame-rate or channel conversion occurs.

Ducking consumes sequence sample intervals. Attack and release are positive sample
counts, hold is nonnegative, and attenuation is nonpositive dB. Speech intervals
whose attack/hold/release supports touch or overlap are merged conservatively to
avoid pumping. Points are clipped to the BGM range, preserving interpolated gain
at the edges rather than resetting to zero. Manual changes create a new proposal;
the engine does not overwrite user envelopes. A versioned wire representation
stores bigint ticks as decimal strings and rejects unsupported versions.

## Providers, artifacts and cache

Cleanup and loudness capabilities carry stable id/version. The engine validates
request range, media identity, channel count, known channel layout and sample rate. Providers receive a
snapshot, an AbortSignal and explicit configuration. Cleanup output must identify a
distinct derivative URI, preserve sample count/rate/channels (and exact channel labels/order when supplied) and report zero residual
latency (the provider must compensate internally). URI checks catch lexical file
aliases; providers remain responsible for not writing the source through filesystem
aliases such as symlinks. No filesystem writes exist in this package.

The runner uses Core Job statuses and artifact promotion. Unsupported, invalid,
failed, cancelled or stale results never replace the previous valid artifact.
Cancellation completes promptly even when a provider ignores AbortSignal. The
caller supplies a synchronous isCurrent predicate covering revision/selection/config;
it is checked before cache reuse and immediately before promotion.

Cache keys include engine/schema version, operation, complete media fingerprint,
media URI/id, rational range, sample format, settings and provider id/version.
Only validated successful results are cached. Cache values are snapshots. Retrying
uses an explicit attempt and a new candidate artifact id; failure preserves current.
Partial success is achieved by separate jobs per media/capability.

## Verification and follow-up

Use small synthetic PCM, literal expected times/levels and provider doubles only at
the external DSP boundary. Test exact NTSC time mapping, invalid PCM/ranges, clipped
ducking ramps, silence/irregular beats, headroom limits, bad derivative outputs,
cache invalidation, cancellation and stale results. Core/Sync tests are regression
checks. Provider doubles prove orchestration, not acoustic quality or standards
compliance. Actual denoising, LUFS/true-peak conformance, listening, decoding, Premiere
integration, persistent cache and real-time preview require later adapters/fixtures.

Output profiles supply target LUFS and ceilings; this change does not choose a
delivery standard. Playback speed changes require regenerated analysis/envelopes
and explicit timing conversion; this package does not time-stretch audio.
