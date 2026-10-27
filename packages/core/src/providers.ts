/**
 * Provider capability interfaces. Engines depend on these, never on vendor
 * SDKs. Every request takes an optional AbortSignal; every result carries
 * canonical Core types plus Provenance. Vendor payloads stop at the provider
 * implementation boundary.
 */
import type { AnalysisTag, Provenance } from "./analysis.js";
import type { EntityId } from "./ids.js";
import type { MediaFingerprint } from "./media.js";
import type { MediaTime, Rational } from "./time.js";
import type { Speaker, TranscriptSegment } from "./transcript.js";

export interface ProviderInfo {
  readonly name: string;
  readonly version: string;
  readonly model?: string;
}

export interface ProviderCallOptions {
  readonly signal?: AbortSignal;
}

export class ProviderAbortedError extends Error {
  override readonly name = "ProviderAbortedError";
  constructor(message = "provider call aborted") {
    super(message);
  }
}

/** Throw ProviderAbortedError when `signal` is already aborted. Call before and after vendor I/O. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ProviderAbortedError();
  }
}

export interface Provider {
  readonly info: ProviderInfo;
}

// --- Speech to text ---------------------------------------------------------

export interface SttRequest {
  readonly mediaAssetId: EntityId;
  /** Local path to an audio rendition the provider can read. */
  readonly audioPath: string;
  /** BCP 47 hint; omit for auto-detect. */
  readonly language?: string;
  readonly diarize?: boolean;
  readonly wordTimings?: boolean;
}

export interface SttResult {
  readonly language: string;
  readonly speakers: readonly Speaker[];
  readonly segments: readonly TranscriptSegment[];
  readonly provenance: Provenance;
}

export interface SttCapabilities {
  readonly diarization: boolean;
  readonly wordTimings: boolean;
  readonly languages?: readonly string[];
}

export interface SttProvider extends Provider {
  readonly capabilities: SttCapabilities;
  transcribe(request: SttRequest, options?: ProviderCallOptions): Promise<SttResult>;
}

// --- Vision -----------------------------------------------------------------

export interface VisionRequest {
  readonly mediaAssetId: EntityId;
  /** Extracted frames the provider should look at. */
  readonly framePaths: readonly string[];
  /** Tag kinds requested, e.g. "scene", "person", "text". */
  readonly kinds: readonly string[];
}

export interface VisionResult {
  readonly tags: readonly AnalysisTag[];
  readonly provenance: Provenance;
}

export interface VisionProvider extends Provider {
  analyze(request: VisionRequest, options?: ProviderCallOptions): Promise<VisionResult>;
}

// --- LLM --------------------------------------------------------------------

export interface LlmPrompt {
  /** Prompt id and version from `prompts/`; recorded in provenance. */
  readonly id: string;
  readonly version: string;
  readonly system?: string;
  readonly user: string;
}

export interface LlmRequest {
  readonly prompt: LlmPrompt;
  /** JSON Schema the provider should constrain output to, when supported. */
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export interface LlmResult {
  readonly text: string;
  /** Parsed JSON when `outputSchema` was given and the provider produced valid JSON. Still a proposal until validated by the caller. */
  readonly json?: unknown;
  readonly provenance: Provenance;
}

export interface LlmProvider extends Provider {
  complete(request: LlmRequest, options?: ProviderCallOptions): Promise<LlmResult>;
}

// --- Translation ------------------------------------------------------------

export interface TranslationSegment {
  readonly id: string;
  readonly text: string;
}

export interface TranslationRequest {
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly segments: readonly TranslationSegment[];
  readonly glossary?: Readonly<Record<string, string>>;
}

export interface TranslationResult {
  readonly targetLanguage: string;
  readonly segments: readonly TranslationSegment[];
  readonly provenance: Provenance;
}

export interface TranslationProvider extends Provider {
  translate(request: TranslationRequest, options?: ProviderCallOptions): Promise<TranslationResult>;
}

// --- Media probe ------------------------------------------------------------

export interface MediaProbeRequest {
  readonly path: string;
  readonly fingerprintStrategy?: "full" | "sampled";
}

export interface MediaProbeResult {
  readonly duration: MediaTime;
  readonly video?: { readonly frameRate: Rational; readonly width: number; readonly height: number };
  readonly audio?: { readonly sampleRate: number; readonly channels: number };
  readonly fingerprint: MediaFingerprint;
}

export interface MediaProbeProvider extends Provider {
  probe(request: MediaProbeRequest, options?: ProviderCallOptions): Promise<MediaProbeResult>;
}
