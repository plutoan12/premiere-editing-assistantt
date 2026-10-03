import type { Transcript } from "./transcript.js"; import type { AnalysisTag } from "./analysis.js";
export interface ProviderContext{signal?:AbortSignal; providerVersion?:string}
export interface SttProvider{transcribe(input:{uri:string},ctx?:ProviderContext):Promise<Transcript>}
export interface VisionProvider{analyze(input:{uri:string},ctx?:ProviderContext):Promise<AnalysisTag[]>}
export interface LlmProvider<T=unknown>{generate(input:unknown,ctx?:ProviderContext):Promise<T>}
export interface TranslationProvider{translate(input:{text:string;sourceLocale:string;targetLocale:string},ctx?:ProviderContext):Promise<{text:string}>}
export interface MediaProbeProvider{probe(input:{uri:string},ctx?:ProviderContext):Promise<Record<string,unknown>>}
