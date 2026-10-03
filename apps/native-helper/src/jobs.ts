import {randomUUID} from 'node:crypto';
import {HelperError, publicError} from './errors.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface JobRecord {id: string; kind: string; status: JobStatus; result?: unknown; error?: {code: string; message: string}}
type Internal = {
  record: JobRecord; controller: AbortController; work: (signal: AbortSignal) => Promise<unknown>;
  done: Promise<void>; resolve: () => void; running: boolean; execution?: Promise<void>;
};
export class JobRegistry {
  private readonly jobs = new Map<string, Internal>();
  private active = 0;
  private closing = false;
  private readonly maxJobs: number;
  private readonly maxConcurrent: number;
  constructor(options: {maxJobs?: number; maxConcurrent?: number} = {}) {
    this.maxJobs = options.maxJobs ?? 16;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    if (!Number.isSafeInteger(this.maxJobs) || this.maxJobs < 1 || this.maxJobs > 64 ||
        !Number.isSafeInteger(this.maxConcurrent) || this.maxConcurrent < 1 || this.maxConcurrent > this.maxJobs) {
      throw new HelperError('INVALID_CONFIG', 'Invalid job capacity', 400);
    }
  }
  submit(kind: string, work: (signal: AbortSignal) => Promise<unknown>): string {
    if (this.closing) throw new HelperError('CLOSING', 'Helper is stopping', 503);
    if (this.jobs.size >= this.maxJobs) throw new HelperError('JOB_CAPACITY', 'Delete terminal jobs before submitting more', 429);
    const id = randomUUID();
    let resolve!: () => void;
    const done = new Promise<void>(ok => {resolve = ok;});
    this.jobs.set(id, {record: {id, kind, status: 'queued'}, controller: new AbortController(), work, done, resolve, running: false});
    queueMicrotask(() => this.pump());
    return id;
  }
  private pump(): void {
    if (this.closing) return;
    for (const job of this.jobs.values()) {
      if (this.active >= this.maxConcurrent) break;
      if (job.record.status !== 'queued') continue;
      job.record.status = 'running'; job.running = true; this.active++;
      job.execution = Promise.resolve().then(() => {
        if (job.controller.signal.aborted) return undefined;
        return job.work(job.controller.signal);
      }).then(result => {
        if (!job.controller.signal.aborted) {job.record.result = structuredClone(result); job.record.status = 'completed';}
      }).catch(error => {
        if (!job.controller.signal.aborted) {
          const safe = publicError(error);
          job.record.error = {code: safe.code, message: safe.message}; job.record.status = 'failed';
        }
      }).finally(() => {job.running = false; this.active--; job.resolve(); this.pump();});
    }
  }
  get(id: string): JobRecord | undefined {const job = this.jobs.get(id); return job ? structuredClone(job.record) : undefined;}
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.record.status === 'completed' || job.record.status === 'failed') return false;
    if (job.record.status === 'cancelled') return true;
    job.record.status = 'cancelled';
    job.controller.abort();
    job.resolve();
    return true;
  }
  delete(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.running || job.record.status === 'queued' || job.record.status === 'running') return false;
    return this.jobs.delete(id);
  }
  async wait(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new HelperError('NOT_FOUND', 'Unknown job', 404);
    await job.done;
  }
  /** Real helper operations honor AbortSignal; do not report shutdown before they exit. */
  async close(): Promise<void> {
    this.closing = true;
    for (const id of this.jobs.keys()) this.cancel(id);
    await Promise.all([...this.jobs.values()].map(job => job.execution));
  }
}
