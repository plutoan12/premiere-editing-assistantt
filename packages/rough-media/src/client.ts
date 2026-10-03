import { aborted, decodePcm, validateDescriptor, validateWindow, type MediaDescriptor, type MediaProvider, type PcmResponse, type WindowRequest } from './types.js';
type Job = { jobId?: string; status?: string; result?: any; media?: unknown; pcm?: any; error?: any };
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 80));
function failure(x: any): Error { return new Error(typeof x?.message === 'string' ? x.message : typeof x === 'string' ? x : 'media job failed'); }
function checkPcm(w: PcmResponse, r: WindowRequest): PcmResponse {
  if (w.meta.startSample !== r.startSample || w.meta.sampleCount !== r.sampleCount || w.meta.channels !== r.media.channels || w.meta.fileIdentity !== r.media.fileIdentity) throw new Error('PCM metadata mismatch');
  decodePcm(w.data, w.meta); return w;
}
/** Polling keeps all UXP JS handles on the scripting thread. The native worker owns no JS handles. */
export function createHybridMediaProvider(addon: { request(input: string): string }): MediaProvider {
  if (typeof addon?.request !== 'function') throw new Error('Hybrid addon unavailable');
  function request(x: unknown): any { const result = JSON.parse(addon.request(JSON.stringify(x))); if (result.error) throw failure(result.error); return result; }
  async function run(input: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    aborted(signal); const job = request(input); if (typeof job.jobId !== 'string' || !job.jobId) throw new Error('invalid native job identity');
    const end = Date.now() + 180000;
    try {
      for (;;) {
        aborted(signal); if (Date.now() > end) throw new Error('native media deadline exceeded');
        const state = request({ op: 'poll', jobId: job.jobId }); aborted(signal);
        if (state.status === 'completed') return state.result;
        if (state.status === 'failed') throw failure(state.error);
        if (state.status === 'cancelled') throw Object.assign(new Error('native media cancelled'), { name: 'AbortError' });
        if (!['queued', 'running'].includes(state.status)) throw new Error('invalid native job status');
        await delay();
      }
    } catch (error) { try { request({ op: 'cancel', jobId: job.jobId }); } catch { /* Preserve original failure. */ } throw error;
    } finally { try { request({ op: 'delete', jobId: job.jobId }); } catch { /* Native delete cancels and joins an outstanding job. */ } }
  }
  return {
    async probe(path, signal) { return validateDescriptor(await run({ op: 'probe', path }, signal)); },
    async readWindow(r, signal) {
      validateWindow(r); const value = await run({ op: 'window', ...r }, signal);
      const maxLength = Math.ceil(r.sampleCount * r.media.channels * 4 / 3) * 4;
      if (typeof value?.pcmBase64 !== 'string' || value.pcmBase64.length !== maxLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.pcmBase64)) throw new Error('invalid native PCM payload');
      const data = new ArrayBuffer(r.sampleCount * r.media.channels * 4), bytes = new Uint8Array(data);
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let bits = 0, count = 0, offset = 0;
      for (const c of value.pcmBase64 as string) { if (c === '=') break; bits = (bits << 6) | alphabet.indexOf(c); count += 6; if (count >= 8) { count -= 8; if (offset >= bytes.length) throw new Error('native PCM overflow'); bytes[offset++] = (bits >>> count) & 255; bits &= (1 << count) - 1; } }
      if (offset !== bytes.length || bits !== 0) throw new Error('invalid native PCM padding');
      return checkPcm({ meta: value.meta, data }, r);
    }
  };
}
export function createHelperMediaProvider(bootstrap: { endpoint: string; token: string }, options: { allowInsecureDev?: boolean; fetch?: typeof fetch } = {}): MediaProvider {
  const u = new URL(bootstrap.endpoint);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/' || (u.protocol !== 'https:' && !(options.allowInsecureDev && u.protocol === 'http:')) || !/^[A-Za-z0-9_-]{32,}$/.test(bootstrap.token)) throw new Error('invalid secure helper bootstrap');
  const fetcher = options.fetch ?? fetch;
  async function request(path: string, body?: unknown, signal?: AbortSignal, method?: string, binary = false): Promise<any> {
    aborted(signal); const c = new AbortController(), timeout = setTimeout(() => c.abort(), 15000);
    const cancel = () => c.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) c.abort();
    try {
      const response = await fetcher(u.origin + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { authorization: `Bearer ${bootstrap.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: c.signal });
      if (!response.ok) throw failure((await response.json().catch(() => ({}))).error ?? `helper HTTP ${response.status}`);
      if (binary) { const length = Number(response.headers.get('content-length')); if (!Number.isSafeInteger(length) || length < 1 || length > 240000 * 2 * 4) throw new Error('PCM response size limit'); const data = await response.arrayBuffer(); if (data.byteLength !== length) throw new Error('PCM response length mismatch'); return data; }
      return await response.json();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  }
  async function run(route: string, input: unknown, signal?: AbortSignal): Promise<{ state: Job; data?: ArrayBuffer }> {
    aborted(signal);
    // Cancellation stays attached until the submission body has been consumed.
    const job = await request(route, input, signal);
    if (typeof job.jobId !== 'string' || !/^[a-f0-9]{32}$/.test(job.jobId)) throw new Error('invalid helper job identity');
    const path = `/v1/audio/jobs/${job.jobId}`, deadline = Date.now() + 180000;
    try {
      for (;;) {
        aborted(signal); if (Date.now() > deadline) throw new Error('helper media deadline exceeded');
        const state: Job = await request(path, undefined, signal);
        if (state.status === 'completed') {
          const data = state.pcm ? await request(path + '/pcm', undefined, signal, 'GET', true) : undefined;
          aborted(signal); return { state, data };
        }
        if (state.status === 'failed') throw failure(state.error);
        if (state.status === 'cancelled') throw Object.assign(new Error('helper media cancelled'), { name: 'AbortError' });
        if (!['queued', 'running'].includes(state.status ?? '')) throw new Error('invalid helper job status');
        await delay();
      }
    } catch (error) { await request(path + '/cancel', {}).catch(() => undefined); throw error;
    } finally { await request(path, undefined, undefined, 'DELETE').catch(() => undefined); }
  }
  return {
    async probe(path, signal) { return validateDescriptor((await run('/v1/media/probe', { path }, signal)).state.media); },
    async readWindow(r, signal) { validateWindow(r); const { state, data } = await run('/v1/audio/window', r, signal); if (!data) throw new Error('missing PCM payload'); return checkPcm({ meta: state.pcm, data }, r); }
  };
}
