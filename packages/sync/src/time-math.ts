import type { MediaTime, Rational } from '@pea/core';
import { SyncValidationError } from './types.js';
export function validateTimebase(value: Rational): void {
  if (!value || !Number.isSafeInteger(value.numerator) || value.numerator <= 0
    || !Number.isSafeInteger(value.denominator) || value.denominator <= 0) {
    throw new SyncValidationError('timebase must contain positive safe integers');
  }
}
export function validateMediaTime(value: MediaTime): void {
  if (!value || typeof value.ticks !== 'bigint') throw new SyncValidationError('bigint time ticks required');
  validateTimebase(value.timebase);
}
export function sameTimebase(a: Rational, b: Rational): boolean {
  validateTimebase(a); validateTimebase(b);
  return BigInt(a.numerator)*BigInt(b.denominator) === BigInt(b.numerator)*BigInt(a.denominator);
}
export function compareTime(a: MediaTime, b: MediaTime): number {
  validateMediaTime(a); validateMediaTime(b);
  const d=a.ticks*BigInt(a.timebase.numerator)*BigInt(b.timebase.denominator)
    -b.ticks*BigInt(b.timebase.numerator)*BigInt(a.timebase.denominator);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}
function gcd(a: bigint,b: bigint): bigint {
  a = a < 0n ? -a : a;
  while(b !== 0n) [a,b]=[b,a%b];
  return a;
}
export function addTime(a: MediaTime,b: MediaTime): MediaTime {
  validateMediaTime(a); validateMediaTime(b);
  if(sameTimebase(a.timebase,b.timebase)) return {ticks:a.ticks+b.ticks,timebase:{...a.timebase}};
  const ad=BigInt(a.timebase.denominator), bd=BigInt(b.timebase.denominator);
  let n=a.ticks*BigInt(a.timebase.numerator)*bd+b.ticks*BigInt(b.timebase.numerator)*ad;
  let d=ad*bd;
  const divisor=gcd(n,d); n/=divisor; d/=divisor;
  if(d>BigInt(Number.MAX_SAFE_INTEGER)) throw new SyncValidationError('combined timebase exceeds safe denominator');
  return {ticks:n,timebase:{numerator:1,denominator:Number(d)}};
}
export const subtractTime=(a:MediaTime,b:MediaTime):MediaTime=>addTime(a,{ticks:-b.ticks,timebase:b.timebase});
