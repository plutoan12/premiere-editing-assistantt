import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AudioSampleWindow} from '@pea/sync';
import {createHash} from 'node:crypto';
import {HelperError} from './errors.js';
import {validateWindowRequest} from './audio-provider.js';

export function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  const data = JSON.stringify(value);
  res.writeHead(status, {'content-type':'application/json','content-length':Buffer.byteLength(data),'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(data);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HelperError('INVALID_REQUEST','A JSON object is required',400);
  return value as Record<string, unknown>;
}
export function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new HelperError('INVALID_REQUEST','Unknown request field',400);
}
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '') ||
      (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'] !== 'identity')) {
    req.resume(); throw new HelperError('CONTENT_TYPE','Use uncompressed application/json',415);
  }
  const max = 65536;
  if (Number(req.headers['content-length']) > max) {req.resume(); throw new HelperError('BODY_TOO_LARGE','Request body too large',413);}
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []; let size = 0;
    const cleanup = () => {clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('aborted',aborted);req.off('error',aborted);};
    const fail = (error: Error) => {cleanup();req.resume();reject(error);};
    const aborted = () => fail(new HelperError('REQUEST_ABORTED','Request disconnected',400));
    const data = (part: Buffer) => {
      size += part.length;
      if (size > max) return fail(new HelperError('BODY_TOO_LARGE','Request body too large',413));
      parts.push(part);
    };
    const end = () => {
      cleanup();
      try {resolve(object(JSON.parse(Buffer.concat(parts,size).toString('utf8'))));}
      catch {reject(new HelperError('INVALID_JSON','Invalid JSON object',400));}
    };
    const timer = setTimeout(() => fail(new HelperError('REQUEST_TIMEOUT','Request body timeout',408)),5000);
    req.on('data',data);req.once('end',end);req.once('aborted',aborted);req.once('error',aborted);
  });
}
export function pcmBytes(window: AudioSampleWindow): Buffer {
  validateWindowRequest(window.sampleRate,{startSample:window.startSample,maxSamples:window.samples.length});
  const data = Buffer.alloc(window.samples.length * 4);
  for (let i = 0; i < window.samples.length; i++) {
    const value = window.samples[i];
    if (!Number.isFinite(value) || Math.abs(value)>1) throw new HelperError('INVALID_PCM','Invalid normalized PCM',422);
    data.writeFloatLE(value,i*4);
  }
  return data;
}
export function binaryAudio(res: ServerResponse, window: AudioSampleWindow): void {
  if (res.destroyed || res.writableEnded) return;
  const data=pcmBytes(window);
  res.writeHead(200,{'content-type':'application/octet-stream','content-length':data.length,'cache-control':'no-store',
    'x-content-type-options':'nosniff','x-pea-format':'f32le','x-pea-sample-rate':String(window.sampleRate),
    'x-pea-start-sample':String(window.startSample),'x-pea-sample-count':String(window.samples.length),
    'x-pea-content-sha256':createHash('sha256').update(data).digest('hex')});
  res.end(data);
}
