import { compareMediaTime, type MediaTime } from "@pea/core";
import { currentTranscript, exportSubtitleDocument, parseSubtitleDocument } from "@pea/transcript";

export interface CaptionTarget {
  projectPath: string;
  sequenceId: string;
  sequenceName: string;
  available: boolean;
}

export interface PreparedCaptionApplication {
  requestId: string;
  expectedProjectPath: string;
  expectedSequenceId: string;
  sequenceName: string;
  documentId: string;
  revisionId: string;
  label: string;
  cueCount: number;
  srt: string;
}

function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) {
    throw new Error("저장된 프로젝트와 활성 시퀀스를 먼저 확인하세요.");
  }
}

function endsAfter(start: MediaTime, duration: MediaTime, next: MediaTime): boolean {
  const a = BigInt(start.timebase.denominator), b = BigInt(duration.timebase.denominator), c = BigInt(next.timebase.denominator);
  const end = start.ticks * BigInt(start.timebase.numerator) * b + duration.ticks * BigInt(duration.timebase.numerator) * a;
  return end * c > next.ticks * BigInt(next.timebase.numerator) * a * b;
}

/** Prepare a reviewed sequence document. SRT already contains placement; the host must import at zero. */
export function prepareCaptionApplication(input: {
  documentJSON: string;
  target: CaptionTarget;
  requestId: string;
}): PreparedCaptionApplication {
  const { target, requestId } = input;
  if (!target || target.available !== true) throw new Error("이 Premiere 시퀀스에서는 캡션 트랙 생성을 사용할 수 없습니다.");
  identity(target.projectPath); identity(target.sequenceId); identity(target.sequenceName);
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(requestId)) {
    throw new Error("invalid caption application identity");
  }
  const doc = parseSubtitleDocument(input.documentJSON);
  if (doc.origin.kind !== "sequence") throw new Error("시퀀스 시작 시각을 지정한 편집본 문서를 저장한 뒤 불러오세요.");
  const cues = currentTranscript(doc).segments;
  if (!cues.length || cues.length > 100000) throw new Error("적용할 자막은 1개 이상 100000개 이하여야 합니다.");
  for (let i = 1; i < cues.length; i++) {
    const prior = cues[i - 1].range, current = cues[i].range;
    if (compareMediaTime(prior.start, current.start) > 0 || endsAfter(prior.start, prior.duration, current.start)) {
      throw new Error("겹치거나 시간 순서가 바뀐 자막을 먼저 수정하세요.");
    }
  }
  return {
    requestId, expectedProjectPath: target.projectPath, expectedSequenceId: target.sequenceId,
    sequenceName: target.sequenceName, documentId: doc.id, revisionId: doc.currentRevisionId,
    label: doc.origin.label, cueCount: cues.length, srt: exportSubtitleDocument(doc, "srt")
  };
}
