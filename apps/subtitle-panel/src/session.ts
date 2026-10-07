import { MediaTimeSchema, type MediaTime, type TimeRange, type TranscriptSegment } from "@pea/core";
import {
  createSubtitleDocument, parseSrt, parseVtt, parseSubtitleDocument,
  serializeSubtitleDocument, searchSubtitleDocument, type SubtitleDocument, type SubtitleOrigin
} from "@pea/transcript";

const detach = (doc: SubtitleDocument): SubtitleDocument => parseSubtitleDocument(serializeSubtitleDocument(doc));

/** A review session is independent of Premiere, its current selection, and helper transport. */
export class SubtitleSession {
  private readonly library = new Map<string, SubtitleDocument>();
  private activeId?: string;
  private pending?: AbortController;

  get documents(): readonly SubtitleDocument[] { return [...this.library.values()].map(detach); }
  get active(): SubtitleDocument | undefined {
    const value = this.activeId === undefined ? undefined : this.library.get(this.activeId);
    return value && detach(value);
  }
  get busy(): boolean { return this.pending !== undefined; }

  selectDocument(id: string): void {
    if (!this.library.has(id)) throw new Error("subtitle document was not found");
    this.activeId = id;
  }

  addDocument(doc: SubtitleDocument): void {
    const candidate = detach(doc);
    if (this.library.has(candidate.id)) throw new Error("this document is already open");
    this.library.set(candidate.id, candidate);
    this.activeId = candidate.id;
  }

  importSubtitle(input: { id: string; origin: SubtitleOrigin; text: string; format: "srt" | "vtt" }): void {
    if (input.format !== "srt" && input.format !== "vtt") throw new Error("unsupported subtitle format");
    const parse = input.format === "srt" ? parseSrt : parseVtt;
    this.addDocument(createSubtitleDocument({
      id: input.id, origin: input.origin, source: input.format,
      transcript: parse(input.text, input.origin.mediaAssetId, `${input.id}:transcript`)
    }));
  }

  openDocument(json: string): void { this.addDocument(parseSubtitleDocument(json)); }

  editActive(change: (doc: SubtitleDocument) => SubtitleDocument): void {
    const current = this.active;
    if (!current) throw new Error("open a subtitle document first");
    const candidate = detach(change(current));
    if (candidate.id !== this.activeId) throw new Error("editing cannot replace the document identity");
    this.library.set(candidate.id, candidate);
  }

  search(query: string): Array<{ documentId: string; label: string; kind: SubtitleOrigin["kind"]; segment: TranscriptSegment }> {
    return [...this.library.values()].flatMap(doc => searchSubtitleDocument(doc, query).map(segment => ({
      documentId: doc.id, label: doc.origin.label, kind: doc.origin.kind, segment
    })));
  }

  /** A superseded or cancelled operation cannot replace review work, even if the provider ignores abort. */
  async load(loader: (signal: AbortSignal) => Promise<SubtitleDocument>): Promise<boolean> {
    this.cancelPending();
    const controller = new AbortController();
    this.pending = controller;
    try {
      const candidate = await loader(controller.signal);
      if (this.pending !== controller || controller.signal.aborted) return false;
      this.addDocument(candidate);
      return true;
    } catch (error) {
      if (this.pending !== controller || controller.signal.aborted) return false;
      throw error;
    } finally {
      if (this.pending === controller) this.pending = undefined;
    }
  }

  cancelPending(): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.abort();
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

function rational(numerator: bigint, denominator: bigint): MediaTime {
  if (numerator < 0n || denominator <= 0n) throw new Error("time must be nonnegative");
  const divisor = gcd(numerator, denominator);
  const reduced = denominator / divisor;
  if (reduced > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("timebase exceeds exact supported precision");
  return { ticks: numerator / divisor, timebase: { numerator: 1, denominator: Number(reduced) } };
}

function fraction(time: MediaTime): [bigint, bigint] {
  MediaTimeSchema.parse(time);
  if (time.ticks < 0n || !Number.isSafeInteger(time.timebase.numerator) || !Number.isSafeInteger(time.timebase.denominator)) {
    throw new Error("invalid nonnegative media time");
  }
  return [time.ticks * BigInt(time.timebase.numerator), BigInt(time.timebase.denominator)];
}

/** Decimal seconds (up to nanoseconds), or an exact fraction for frame/sample timebases. */
export function parseSubtitleTime(value: string): MediaTime {
  if (typeof value !== "string" || value.length > 128) throw new Error("invalid subtitle time");
  const input = value.trim();
  const fractional = /^(\d+)\/(\d+)$/.exec(input);
  if (fractional) {
    if (BigInt(fractional[2]) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("timebase exceeds exact supported precision");
    return rational(BigInt(fractional[1]), BigInt(fractional[2]));
  }
  const decimal = /^(\d+)(?:\.(\d{1,9}))?$/.exec(input);
  if (!decimal) throw new Error("시간은 0 이상의 초로 입력하세요. 예: 12.5");
  const scale = 10n ** BigInt(decimal[2]?.length ?? 0);
  return rational(BigInt(decimal[1]) * scale + BigInt(decimal[2] ?? "0"), scale);
}

export function formatSubtitleTime(time: MediaTime): string {
  const [numerator, denominator] = fraction(time);
  const reduced = rational(numerator, denominator);
  const den = BigInt(reduced.timebase.denominator), ticks = reduced.ticks;
  // Use a fraction instead of rounding a repeating decimal: editing text must not shift frame times.
  if (1_000_000_000n % den !== 0n) return `${ticks}/${den}`;
  const nanoseconds = ticks * (1_000_000_000n / den);
  const decimals = String(nanoseconds % 1_000_000_000n).padStart(9, "0").replace(/0+$/, "");
  return `${nanoseconds / 1_000_000_000n}${decimals ? `.${decimals}` : ""}`;
}

export function subtitleRange(start: string, end: string): TimeRange {
  const first = parseSubtitleTime(start), last = parseSubtitleTime(end);
  const [a, b] = fraction(first), [c, d] = fraction(last);
  if (c * b <= a * d) throw new Error("끝 시간은 시작 시간보다 뒤여야 합니다.");
  return { start: first, duration: rational(c * b - a * d, b * d) };
}

export function cueEnd(segment: { range: TimeRange }): MediaTime {
  const [a, b] = fraction(segment.range.start), [c, d] = fraction(segment.range.duration);
  return rational(a * d + c * b, b * d);
}
