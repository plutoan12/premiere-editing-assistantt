/** In-place radix-2 FFT. This module is internal to bounded audio correlation. */
function fft(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= n; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepR = Math.cos(angle), stepI = Math.sin(angle), half = length / 2;
    for (let start = 0; start < n; start += length) {
      let wr = 1, wi = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half;
        const vr = real[b] * wr - imaginary[b] * wi;
        const vi = real[b] * wi + imaginary[b] * wr;
        real[b] = real[a] - vr; imaginary[b] = imaginary[a] - vi;
        real[a] += vr; imaginary[a] += vi;
        const nextR = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR; wr = nextR;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imaginary[i] /= n; }
}
/** result[take.length - 1 + lag] = sum(reference[j + lag] * take[j]). */
export function correlationProducts(reference: ArrayLike<number>, take: ArrayLike<number>): Float64Array {
  let n = 1;
  while (n < reference.length + take.length - 1) n *= 2;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  for (let i = 0; i < reference.length; i++) ar[i] = reference[i];
  for (let i = 0; i < take.length; i++) br[i] = take[take.length - 1 - i];
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const real = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = real;
  }
  fft(ar, ai, true);
  return ar;
}
