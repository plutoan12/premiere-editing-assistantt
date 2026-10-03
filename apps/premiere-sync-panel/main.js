'use strict';
const {entrypoints, storage} = require('uxp');
const ppro = require('premierepro');
const {SyncController} = require('./controller.js');
const {readSelection, sameSelection} = require('./selection.js');
const fs = storage.localFileSystem;
const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
const disabled = (id, value) => { const el = document.getElementById(id); if (el) el.disabled = value; };
const phases = {disconnected:'연결되지 않음',connecting:'보안 연결 확인 중',ready:'분석 준비',submitting:'작업 접수 중',running:'파일 분석 중',cancelling:'취소 요청 중',cancelled:'취소됨',completed:'분석 완료 · 검토 필요',unknown:'작업 상태 불명 · 재전송하지 않음',stale:'프로젝트 또는 선택이 바뀜 · 다시 분석 필요',error:'검토할 수 없는 결과'};
const reasons = {AUDIO_MATCH:'파형 일치',SILENCE:'무음',AMBIGUOUS_PEAK:'반복음 또는 여러 후보',INSUFFICIENT_OVERLAP:'겹치는 구간 부족',LOW_CORRELATION:'유사도 부족',SEARCH_BOUNDARY:'검색 범위 경계',PROVIDER_ERROR:'파일 처리 오류',MISSING_EVIDENCE:'근거 부족'};
let referenceIndex = 0, installed = false, uiBusy = false;
const controller = new SyncController({
  isCurrent: async snapshot => { try { return sameSelection(snapshot, await readSelection(ppro)); } catch { return false; } },
  onChange: render
});
function render(state = controller.state) {
  const selected = controller.selection;
  const busy = Boolean(controller.active) || state.phase === 'connecting' || uiBusy;
  text('status', phases[state.phase] || state.phase);
  disabled('connect', busy);disabled('capture', busy);disabled('reference', busy || !selected);
  disabled('run', busy || !selected || state.phase === 'disconnected');
  disabled('cancel', !controller.active);disabled('retry', state.phase !== 'unknown' || !controller.active || !controller.active.id);
  disabled('export', busy || !state.report);
  if (selected) {
    text('sources', selected.clips.map((c,i) => `${i+1}. ${c.name || c.clipId}`).join('\n'));
    text('reference', `기준: ${referenceIndex+1}. ${selected.clips[referenceIndex].name || selected.clips[referenceIndex].clipId} (눌러 변경)`);
  }
  if (state.report) {
    const group = state.report.group;
    text('result', group.candidates.map(c => {
      const clip = selected.clips.find(x => x.clipId === c.clipId), member = group.members.find(x => x.clipId === c.clipId);
      const offset = member && member.offset;
      const approximate = offset ? (Number(offset.ticks)*offset.timebase.numerator/offset.timebase.denominator).toFixed(6) : null;
      return `${clip ? clip.name : c.clipId}: ${reasons[c.reason] || c.reason}\n`+
        (offset ? `  약 ${approximate}초 (${offset.ticks} × ${offset.timebase.numerator}/${offset.timebase.denominator}초)\n` : '')+
        `  파형 유사도 ${c.confidence.score.toFixed(3)} · ${c.status === 'matched' ? '직접 검토 필요' : '자동 확정 안 함'}`;
    }).join('\n\n'));
  } else if (state.phase === 'unknown') {
    text('result', '접수된 작업은 자동으로 다시 만들지 않아. 상태 재조회 또는 취소를 사용해. 접수 응답 자체가 끊겨 작업 번호를 모르면 Helper를 종료하고 패널을 다시 로드해야 해.');
  } else { text('result', '원본과 시퀀스는 변경하지 않아. '+(state.error || '')); }
}
function guard(work, lock = true) { return async () => {
  if (lock && uiBusy) return;
  if (lock) uiBusy = true;
  try { render(); await work(); }
  catch (error) {
    // Arbitrary host or file errors may contain private paths. Show only known code-shaped diagnostics.
    const code = error && (error.code || error.message);
    text('result', `작업을 완료하지 못했어. ${typeof code === 'string' && /^[A-Z_0-9]{1,64}$/.test(code) ? code : 'HOST_OR_FILE_ERROR'}`);
  } finally { if (lock) uiBusy = false; renderButtons(); }
}; }
function renderButtons() {
  const state = controller.state, busy = Boolean(controller.active) || state.phase === 'connecting' || uiBusy;
  disabled('connect',busy);disabled('capture',busy);disabled('reference',busy || !controller.selection);
  disabled('run',busy || !controller.selection || state.phase === 'disconnected');disabled('export',busy || !state.report);
  disabled('cancel',!controller.active);disabled('retry',state.phase !== 'unknown' || !controller.active || !controller.active.id);
}
async function connect() {
  const file = await fs.getFileForOpening({types:['json']});if (!file) return;
  const metadata = await file.getMetadata();if (metadata.size > 16384) throw new Error('SESSION_FILE_TOO_LARGE');
  const value = await file.read();if (value.length > 16384) throw new Error('SESSION_FILE_TOO_LARGE');
  await controller.connect(JSON.parse(value));
}
async function capture() {
  const selection = await readSelection(ppro);referenceIndex = 0;controller.setSelection(selection,selection.clips[0].clipId);
}
async function exportReport() {
  await controller.reviewReport();
  const file = await fs.getFileForSaving('pea-sync-review.json',{types:['json']});if (!file) return;
  // Revalidate after the save dialog as well; the project can change while a dialog is open.
  const report = await controller.reviewReport();
  await file.write(JSON.stringify({reportType:'analysis-only',humanReview:'pending',...report},null,2));
}
entrypoints.setup({panels:{'pea-sync-review':{
  show() {
    if (installed) return;installed = true;
    document.getElementById('connect').addEventListener('click',guard(connect));
    document.getElementById('capture').addEventListener('click',guard(capture));
    document.getElementById('reference').addEventListener('click',guard(async()=>{const s=controller.selection;referenceIndex=(referenceIndex+1)%s.clips.length;controller.setSelection(s,s.clips[referenceIndex].clipId);}));
    document.getElementById('run').addEventListener('click',guard(()=>controller.run()));
    document.getElementById('cancel').addEventListener('click',guard(()=>controller.cancel(),false));
    document.getElementById('retry').addEventListener('click',guard(()=>controller.retryStatus(),false));
    document.getElementById('export').addEventListener('click',guard(exportReport));render();
  }
}}});
