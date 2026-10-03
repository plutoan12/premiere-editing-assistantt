import type {AudioDspService} from './audio-dsp.js';
import {validateMeasureInput,validateNormalizeInput} from './dsp-meter.js';
import {HelperError} from './errors.js';
/** Validation and detached snapshots happen before a job enters the shared queue. */
export function prepareAudioJob(service:AudioDspService,kind:string,value:unknown):(signal:AbortSignal)=>Promise<unknown>{
  if(kind==='audio-measure'){const input=validateMeasureInput(value);return signal=>service.measure(input,signal);}
  if(kind==='audio-normalize'){const input=validateNormalizeInput(value);return signal=>service.normalize(input,signal);}
  throw new HelperError('INVALID_JOB','Unsupported audio job kind',400);
}
