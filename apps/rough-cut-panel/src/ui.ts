import { createPremiereHost } from '@pea/premiere-rough-cut';
import { createHelperMediaProvider, createHybridMediaProvider } from '@pea/rough-media/client';
import { createRoughController } from './controller.js';
declare const PEA_HYBRID: boolean;
export function install(input: { ppro: any; fs: any; getBootstrap: () => any; loadNative: () => { request(input: string): string } }) {
  const el = (id: string) => { const node = document.getElementById(id); if (!node) throw new Error(`missing UI element: ${id}`); return node; };
  const disable = (id: string, value: boolean) => { (el(id) as HTMLButtonElement).disabled = value; };
  let lastRows = '';
  const controller = createRoughController(createPremiereHost(input.ppro, input.fs), render);
  function render() {
    const state = controller.state(); el('rough-status').textContent = state.message || `분석 방식: ${PEA_HYBRID ? 'AVFoundation Hybrid' : 'FFmpeg Helper'}`;
    el('rough-progress').textContent = state.busy ? `${Math.round(state.progress * 100)}%` : '';
    disable('rough-analyze', state.busy); disable('rough-cancel', !state.canCancel); disable('rough-preview', !state.canPreview); disable('rough-apply', !state.canApply);
    const key = JSON.stringify([state.candidates, state.busy]);
    if (key !== lastRows) {
      lastRows = key; const list = el('rough-candidates'); while (list.firstChild) list.removeChild(list.firstChild);
      for (const c of state.candidates) {
        const row = document.createElement('div'), label = document.createElement('span'), select = document.createElement('select');
        label.textContent = `${c.start.toFixed(2)} ~ ${c.end.toFixed(2)}초 `;
        for (const [value, title] of [['pending', '미확정 · 유지'], ['keep', '유지 확정'], ['exclude', '제외 확정']]) { const option = document.createElement('option'); option.value = value; option.textContent = title; option.selected = c.action === value; if (value === 'pending') option.disabled = true; select.appendChild(option); }
        select.disabled = state.busy; select.addEventListener('change', () => guard(() => controller.review(c.id, select.value as 'keep' | 'exclude'))());
        row.appendChild(label); row.appendChild(select); list.appendChild(row);
      }
    }
  }
  function guard(action: () => unknown) { return async () => { try { await action(); } catch (e) { el('rough-status').textContent = e instanceof Error ? e.message : String(e); } }; }
  el('rough-analyze').addEventListener('click', guard(async () => {
    const provider = PEA_HYBRID ? createHybridMediaProvider(input.loadNative()) : (() => { const b = input.getBootstrap(); if (!b) throw new Error('먼저 HTTPS Helper에 연결해'); return createHelperMediaProvider(b); })();
    await controller.analyze(provider);
  }));
  el('rough-cancel').addEventListener('click', () => controller.cancel());
  el('rough-preview').addEventListener('click', guard(() => controller.preview()));
  el('rough-apply').addEventListener('click', guard(() => controller.apply()));
  render();
}
