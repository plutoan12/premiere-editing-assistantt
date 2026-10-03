'use strict';
const {createClient} = require('./client.js');
const clone = value => JSON.parse(JSON.stringify(value));
const fail = code => { const error = new Error(code); error.code = code; return error; };

function validateResult(result, input) {
  const group = result && result.group, ids = new Set(input.clips.map(c => c.clipId));
  if (!group || result.sampleRate !== input.sampleRate || group.referenceClipId !== input.referenceClipId ||
      !['matched', 'partial', 'review'].includes(group.status) || !Array.isArray(group.members) || !Array.isArray(group.candidates) ||
      group.candidates.length !== ids.size - 1 || group.members.length < 1 || group.members.length > ids.size) throw fail('INVALID_SYNC_RESULT');
  const memberIds = new Set(), candidateIds = new Set();
  for (const member of group.members) {
    const t = member.offset, base = t && t.timebase;
    if (!ids.has(member.clipId) || memberIds.has(member.clipId) || !t || typeof t.ticks !== 'string' || !/^-?(0|[1-9][0-9]{0,18})$/.test(t.ticks) ||
        !base || !Number.isSafeInteger(base.numerator) || base.numerator < 1 || !Number.isSafeInteger(base.denominator) || base.denominator < 1) throw fail('INVALID_SYNC_RESULT');
    memberIds.add(member.clipId);
  }
  if (!memberIds.has(input.referenceClipId) || group.members.find(m => m.clipId === input.referenceClipId).offset.ticks !== '0') throw fail('INVALID_SYNC_RESULT');
  let matched = 0;
  for (const c of group.candidates) {
    if (!ids.has(c.clipId) || c.clipId === input.referenceClipId || candidateIds.has(c.clipId) || !['matched', 'review'].includes(c.status) ||
        typeof c.reason !== 'string' || !/^[A-Z_]{1,64}$/.test(c.reason) || !c.confidence || !Number.isFinite(c.confidence.score) ||
        c.confidence.score < 0 || c.confidence.score > 1 || memberIds.has(c.clipId) !== (c.status === 'matched')) throw fail('INVALID_SYNC_RESULT');
    if (c.status === 'matched') matched++;
    candidateIds.add(c.clipId);
  }
  if (group.status !== (matched === ids.size - 1 ? 'matched' : matched ? 'partial' : 'review')) throw fail('INVALID_SYNC_RESULT');
  // Keep the canonical report, but never bootstrap credentials or arbitrary unbounded data.
  const text = JSON.stringify(result);
  if (text.length > 65536) throw fail('INVALID_SYNC_RESULT');
  return clone(result);
}

class SyncController {
  constructor(options = {}) {
    this.makeClient = options.makeClient || createClient;
    this.isCurrent = options.isCurrent || (async () => false);
    this.onChange = options.onChange || (() => {});
    this.pollMs = options.pollMs === undefined ? 500 : options.pollMs;
    this._state = {phase: 'disconnected', report: null, error: null};
    this._selection = null; this._reference = null; this._client = null; this.active = null; this.connecting = false;
  }
  get state() { return clone(this._state); }
  get selection() { return this._selection ? clone(this._selection) : null; }
  update(phase, extra = {}) { this._state = {...this._state, phase, ...extra}; this.onChange(this.state); }
  async connect(session) {
    if (this.active || this.connecting) throw fail('BUSY');
    this.connecting = true; this._client = null; this.update('connecting', {report: null, error: null});
    try {
      const client = this.makeClient(session); await client.ping(); this._client = client; this.update('ready');
    } catch (error) { this.update('disconnected', {error: 'CONNECTION_FAILED'}); throw error; }
    finally { this.connecting = false; }
  }
  setSelection(selection, referenceClipId) {
    if (this.active || this.connecting) throw fail('BUSY');
    if (!selection || typeof selection.projectKey !== 'string' || !Array.isArray(selection.clips) || selection.clips.length < 2 || selection.clips.length > 16) throw fail('INVALID_SELECTION');
    const ids = new Set();
    for (const c of selection.clips) {
      if (typeof c.clipId !== 'string' || !c.clipId || ids.has(c.clipId) || typeof c.path !== 'string' || !c.path.startsWith('/')) throw fail('INVALID_SELECTION');
      ids.add(c.clipId);
    }
    if (!ids.has(referenceClipId)) throw fail('REFERENCE_REQUIRED');
    this._selection = clone(selection); this._reference = referenceClipId;
    this.update(this._client ? 'ready' : 'disconnected', {report: null, error: null});
  }
  async run(settings = {}) {
    if (this.active || this.connecting) throw fail('BUSY');
    if (!this._client || !this._selection) throw fail('CONNECT_AND_SELECT_FIRST');
    const maxSamples = settings.maxSamples === undefined ? 160000 : settings.maxSamples;
    const sampleRate = settings.sampleRate === undefined ? 8000 : settings.sampleRate;
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 64 || maxSamples > 262144 || sampleRate !== 8000) throw fail('INVALID_WINDOW');
    const ctx = {client: this._client, selection: clone(this._selection), id: null, cancelled: false, polling: false, cancelPromise: null, terminal: false};
    ctx.input = {referenceClipId: this._reference, sampleRate, maxSamples,
      clips: ctx.selection.clips.map(c => ({clipId: c.clipId, path: c.path, startSample: c.startSample || '0'}))};
    this.active = ctx; this.update('submitting', {report: null, error: null});
    let posted = false;
    try {
      if (!await this.isCurrent(ctx.selection)) { this.active = null; this.update('stale'); return; }
      if (ctx.cancelled) { this.active = null; this.update('cancelled'); return; }
      posted = true;
      const submitted = await ctx.client.submit(ctx.input); ctx.id = submitted.id;
      if (typeof ctx.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(ctx.id)) throw fail('INVALID_JOB_ID');
      if (ctx.cancelled) await this.sendCancel(ctx);
      await this.poll(ctx);
    } catch (error) {
      if (this.active === ctx) {
        if (!posted) this.active = null;
        this.update(posted ? 'unknown' : 'error', {report: null, error: posted ? 'JOB_STATUS_UNKNOWN' : 'SELECTION_CHECK_FAILED'});
      }
      throw error;
    }
  }
  async sendCancel(ctx) {
    if (!ctx.id) return;
    if (!ctx.cancelPromise) ctx.cancelPromise = ctx.client.cancel(ctx.id).catch(error => {
      ctx.cancelPromise = null;
      if (error && error.code === 'HTTP_409') return; // It finished between polling and cancellation; still suppress its report.
      throw error;
    });
    await ctx.cancelPromise;
  }
  async cancel() {
    const ctx = this.active;
    if (!ctx) return;
    ctx.cancelled = true; this.update('cancelling', {report: null});
    if (ctx.id) {
      try { await this.sendCancel(ctx); if (!ctx.polling) await this.poll(ctx); }
      catch (error) { this.update('unknown', {error: 'CANCEL_NOT_CONFIRMED'}); throw error; }
    }
  }
  async retryStatus() {
    const ctx = this.active;
    if (!ctx || !ctx.id) throw fail('RESTART_HELPER_IF_SUBMISSION_UNKNOWN');
    if (ctx.polling) throw fail('BUSY');
    if (ctx.cancelled) await this.sendCancel(ctx);
    await this.poll(ctx);
  }
  async poll(ctx) {
    if (ctx.polling) throw fail('BUSY');
    ctx.polling = true;
    try {
      for (;;) {
        this.update(ctx.cancelled ? 'cancelling' : 'running', {error: null});
        const job = await ctx.client.getJob(ctx.id);
        if (!job || job.id !== ctx.id || job.kind !== 'sync' || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status)) throw fail('INVALID_JOB');
        if (['queued', 'running'].includes(job.status)) { await new Promise(resolve => setTimeout(resolve, this.pollMs)); continue; }
        ctx.terminal = true;
        try {
          if (ctx.cancelled || job.status === 'cancelled') { this.update('cancelled', {report: null}); return; }
          if (job.status === 'failed') { this.update('error', {report: null, error: 'SYNC_JOB_FAILED'}); return; }
          const result = validateResult(job.result, ctx.input);
          if (!await this.isCurrent(ctx.selection)) { this.update('stale', {report: null}); return; }
          if (ctx.cancelled) { this.update('cancelled', {report: null}); return; }
          this.update('completed', {report: result, error: null});
          return;
        } finally {
          this.active = null;
          try { await ctx.client.remove(ctx.id); } catch { /* A terminal report remains valid if cleanup must be retried in the helper. */ }
        }
      }
    } catch (error) {
      this.update(ctx.terminal ? 'error' : 'unknown', {report: null, error: ctx.terminal ? 'INVALID_SYNC_RESULT' : 'JOB_STATUS_UNKNOWN'});
      throw error;
    } finally { ctx.polling = false; }
  }
  async reviewReport() {
    if (this.active || !this._selection || !this._state.report) throw fail('NO_CURRENT_REPORT');
    const report = this._state.report, selection = this._selection;
    if (!await this.isCurrent(selection) || this._selection !== selection || this._state.report !== report) {
      this.update('stale', {report: null}); throw fail('SELECTION_CHANGED');
    }
    return clone(report);
  }
}
module.exports = {SyncController};
