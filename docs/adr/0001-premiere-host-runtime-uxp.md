# ADR-0001: Premiere host runtime is UXP with a local sidecar service

**Date:** 2026-10-27
**Status:** Accepted
**Deciders:** project owner
**Related:** `docs/superpowers/specs/2026-10-03-premiere-editing-assistant-platform-design.md` (Decision Records); `docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md` on the `feat/core-contracts` integration branch, which already specifies the UXP panel, the loopback token-authenticated native helper and its HTTP job contract. This ADR records the same direction at platform level; the "sidecar" here is that native helper.

## Context
The platform needs a Premiere Pro-facing UI (`apps/premiere-panel`) and a place to run the engines (sync, media analysis, STT, rough cut, audio, delivery). Those engines depend on Node.js, native binaries (ffmpeg/ffprobe-class tools), large local files and long-running CPU/GPU work.

Premiere Pro exposes two extensibility models:
- **CEP** (Common Extensibility Platform): an embedded Chromium panel with a Node.js runtime. Engines could run inside the panel process. CEP is Adobe's legacy model; Adobe's stated direction for new panels is UXP, and CEP's embedded browser lags current web standards.
- **UXP** (Unified Extensibility Platform): Adobe's current plugin runtime, now available for Premiere Pro. It has no Node.js, no child processes, a sandboxed file system API, and network access limited to `fetch`/`WebSocket` against manifest-declared hosts.

The spec requires that engines stay NLE-independent, that Jobs report progress and support cancellation, and that the Premiere adapter validates every write before it touches the project. The host runtime decides how all of that crosses process boundaries.

## Decision
Build the Premiere integration on **UXP**, with engines running in a **local sidecar service** (`apps/sidecar`, Node.js 22) on the same machine.

Concretely:
1. **Two processes.** The UXP panel owns UI and all Premiere project reads/writes through the UXP Premiere API. The sidecar owns Core, every engine, provider access, caching and artifacts. Neither imports the other's code; they share only `@pea/core` contracts.
2. **Transport.** The panel talks to the sidecar over loopback only (`127.0.0.1`): HTTP for commands and queries, WebSocket for Job progress, log and completion events. The UXP manifest declares the loopback host under its network permissions.
3. **Authentication.** The sidecar generates a per-launch random token and writes it, together with its port, to a connection file in the plugin's data directory. The panel reads that file via the UXP storage API and sends the token on every request. The sidecar rejects any request without a valid token and never binds to a non-loopback interface.
4. **Job model over the wire.** `Job`, `JobStatus`, `JobItemResult` and `Artifact` from Core are the wire format, serialized with the versioned Core schemas. `AbortSignal` on the sidecar side maps one-to-one to a `cancel` message from the panel. Progress events are advisory; state changes come only from the Job state machine.
5. **Premiere writes as operation plans.** The Premiere adapter (`adapters/premiere`) runs in the sidecar and translates canonical decisions into a serialized, versioned **Premiere operation plan** (create bins, import media, add markers, build sequences, place clips, apply MOGRTs, write captions, queue exports). The panel validates the plan against the schema and the live project, then executes it step by step through the UXP API and reports per-step results back as `JobItemResult`s. The panel contains no editorial logic.
6. **Sidecar lifecycle.** The installer registers the sidecar as a user-level background service (launchd on macOS, Task Scheduler/Windows Service on Windows). The panel detects an unreachable sidecar, shows the state and a one-click start/repair path, and never pretends work is running. The exact packaging is decided in the Premiere panel plan.
7. **Version handshake.** On connect the panel and sidecar exchange their `CORE_SCHEMA_VERSION` and app versions. The spec's schema compatibility policy applies; an incompatible pair refuses to operate and tells the user which component to update.

## Alternatives considered
- **CEP with engines in-process.** Simplest IPC, but builds on a runtime Adobe is moving away from, ties engine lifetime to the panel process (a panel reload kills a running STT job), and would have to be rewritten for UXP later. Rejected.
- **Everything inside UXP.** No Node.js, no native binaries, no background execution; media analysis and STT are not feasible. Rejected.
- **Standalone desktop app with file round-trips (FCPXML/EDL/SRT/CSV import).** No live project integration and no in-app progress. Rejected as the primary path, but kept as the **fallback for operations the UXP Premiere API cannot perform** (see Risks).
- **Cloud service instead of a local sidecar.** Out of scope per the spec's non-goals (no cloud collaboration in v1) and would require uploading source media. Rejected for v1; the loopback transport is designed so a remote endpoint could be added later without changing engines.

## Consequences
**Positive**
- Engines are already process-isolated from the NLE, which makes the Final Cut Pro and DaVinci Resolve adapters a matter of adding another thin host client to the same sidecar.
- A panel crash or reload does not lose a running Job; the sidecar keeps the Job state machine and artifacts.
- Core stays transport-agnostic; the Core implementation plan is unchanged by this decision.
- Every Premiere write goes through a validated, replayable operation plan, which satisfies the spec's "validate before NLE writes" rule and makes adapter integration tests cheap (assert on the plan, not on Premiere).

**Negative**
- Two components to install, version and support. The version handshake and the installer are mandatory work, not polish.
- Loopback IPC adds latency and serialization cost for chatty operations; the operation plan is batched to keep the number of round trips small.
- The panel must re-implement small amounts of validation (schema plus live-project checks) that also exist in the sidecar, because only the panel can see the live project.

## Risks and mitigations
- **UXP Premiere API coverage gaps** (markers, captions, MOGRT parameters, export presets may be partially exposed). Mitigation: the Premiere adapter plan starts with a capability matrix of required operations against the current UXP API; any operation not supported natively falls back to generated files imported through the panel (sequence XML, SRT/caption files, CSV marker lists), and the plan records which path was used.
- **Sidecar not running or blocked by security software.** Mitigation: explicit connection state in the panel, a repair action, and documentation of the loopback-only, token-authenticated design.
- **UXP manifest/network permission changes across Premiere versions.** Mitigation: pin the minimum Premiere version in the panel manifest and test the handshake in the adapter integration suite.

## Follow-ups
- Add `apps/sidecar/` to the repository shape (done in the spec with this ADR).
- Premiere adapter plan: capability matrix, operation plan schema (`schemas/v1/premiere-ops.schema.json`), panel-side executor.
- Panel plan: connection file format, handshake, service registration per OS.
