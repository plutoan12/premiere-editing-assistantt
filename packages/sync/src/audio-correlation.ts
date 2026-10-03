import type { AudioSampleWindow } from './audio-provider.js';
import { validateAudioWindow } from './audio-provider.js';
import type { SyncReason } from './types.js';
import { SyncValidationError, throwIfAborted } from './types.js';
import { correlationSums } from './fft.js';

export interface AudioCorrelationOptions {
  maxLagSamples?: number;
  minOverlapSamples?: number;
  minScore?: number;
  minMargin?: number;
  peakExclusionSamples?: number;
  signal?: AbortSignal;
}
export interface AudioCorrelationResult {
  status: 'matched' | 'review';
  /** Target placement relative to reference WINDOW zero. Review results deliberately have no offset. */
  offsetSamples: number | null;
  score: number;
  secondBestScore: number;
  margin: number;
  overlapSamples: number;
  polarity: 'normal' | 'inverted' | null;
  reason: SyncReason;
  method: 'fft-ncc-v1';
}
function moments(samples:Float32Array):{sum:Float64Array;square:Float64Array} {
  const sum=new Float64Array(samples.length+1),square=new Float64Array(samples.length+1);
  for(let i=0;i<samples.length;i++){sum[i+1]=sum[i]+samples[i];square[i+1]=square[i]+samples[i]*samples[i];}
  return {sum,square};
}
function variance(m:ReturnType<typeof moments>,start:number,n:number):number {
  const sum=m.sum[start+n]-m.sum[start];
  return Math.max(0,m.square[start+n]-m.square[start]-sum*sum/n);
}
/** Full bounded lag scan with overlap-normalized, mean-centered cross-correlation.
 * FFT obtains global candidates; exact dot product refines the selected peak.
 * Score is similarity, NOT probability. A host worker should run this CPU-bound call.
 */
export function correlateAudio(reference:AudioSampleWindow,target:AudioSampleWindow,
  options:AudioCorrelationOptions={}):AudioCorrelationResult {
  throwIfAborted(options.signal);validateAudioWindow(reference);validateAudioWindow(target);
  const a=reference.samples,b=target.samples;
  const maxLag=options.maxLagSamples??Math.max(a.length,b.length,1)-1;
  const minOverlap=options.minOverlapSamples??Math.max(32,Math.floor(Math.min(a.length,b.length)/2));
  const minScore=options.minScore??.8,minMargin=options.minMargin??.1,exclusion=options.peakExclusionSamples??1;
  if(!Number.isSafeInteger(maxLag)||maxLag<0) throw new SyncValidationError('max lag must be a non-negative integer');
  if(!Number.isSafeInteger(minOverlap)||minOverlap<16) throw new SyncValidationError('minimum overlap must be at least 16 samples');
  if(!Number.isFinite(minScore)||minScore<=0||minScore>1) throw new SyncValidationError('score threshold must be in (0,1]');
  if(!Number.isFinite(minMargin)||minMargin<=0||minMargin>1) throw new SyncValidationError('margin threshold must be in (0,1]');
  if(!Number.isSafeInteger(exclusion)||exclusion<0||exclusion>=minOverlap/2) throw new SyncValidationError('invalid peak exclusion radius');
  const empty=(reason:SyncReason):AudioCorrelationResult=>({status:'review',offsetSamples:null,score:0,
    secondBestScore:0,margin:0,overlapSamples:0,polarity:null,reason,method:'fft-ncc-v1'});
  if(reference.sampleRate!==target.sampleRate) return empty('SAMPLE_RATE_MISMATCH');
  if(Math.min(a.length,b.length)<minOverlap) return empty('INSUFFICIENT_OVERLAP');
  const am=moments(a),bm=moments(b);
  if(variance(am,0,a.length)/a.length<1e-12 || variance(bm,0,b.length)/b.length<1e-12) return empty('SILENCE');
  const sums=correlationSums(a,b);
  const low=Math.max(-maxLag,-b.length+minOverlap),high=Math.min(maxLag,a.length-minOverlap);
  const peaks:{lag:number;score:number;signed:number;n:number}[]=[];
  for(let lag=low;lag<=high;lag++) {
    if((lag-low)%4096===0) throwIfAborted(options.signal);
    const ai=Math.max(0,lag),bi=Math.max(0,-lag),n=Math.min(a.length-ai,b.length-bi);
    const av=variance(am,ai,n),bv=variance(bm,bi,n);
    if(av/n<1e-12 || bv/n<1e-12) continue;
    const asum=am.sum[ai+n]-am.sum[ai],bsum=bm.sum[bi+n]-bm.sum[bi];
    const signed=Math.max(-1,Math.min(1,(sums[lag+b.length-1]-asum*bsum/n)/Math.sqrt(av*bv)));
    peaks.push({lag,score:Math.abs(signed),signed,n});
  }
  if(!peaks.length) return empty('INSUFFICIENT_OVERLAP');
  // Stable deterministic tie break: most overlap, then smallest absolute shift.
  peaks.sort((x,y)=>y.score-x.score || y.n-x.n || Math.abs(x.lag)-Math.abs(y.lag) || x.lag-y.lag);
  const best=peaks[0];
  const ai=Math.max(0,best.lag),bi=Math.max(0,-best.lag);
  let dot=0;for(let i=0;i<best.n;i++) dot+=a[ai+i]*b[bi+i];
  const asum=am.sum[ai+best.n]-am.sum[ai],bsum=bm.sum[bi+best.n]-bm.sum[bi];
  const exact=(dot-asum*bsum/best.n)/Math.sqrt(variance(am,ai,best.n)*variance(bm,bi,best.n));
  best.signed=Math.max(-1,Math.min(1,exact));best.score=Math.abs(best.signed);
  const second=peaks.find(x=>Math.abs(x.lag-best.lag)>exclusion)?.score??0;
  const margin=Math.max(0,best.score-second);
  const reason:SyncReason=best.score<minScore?'LOW_CORRELATION':margin<minMargin?'AMBIGUOUS_PEAK':'AUDIO_MATCH';
  const accepted=reason==='AUDIO_MATCH';
  return {status:accepted?'matched':'review',offsetSamples:accepted?best.lag:null,
    score:best.score,secondBestScore:second,margin,overlapSamples:best.n,
    polarity:best.signed<0?'inverted':'normal',reason,method:'fft-ncc-v1'};
}
