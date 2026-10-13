/** Iterative radix-2 FFT. Internal bounded buffers only; no input media is mutated. */
function fft(real: Float64Array, imag: Float64Array, inverse: boolean): void {
  const n=real.length;
  for(let i=1,j=0;i<n;i++) {
    let bit=n>>1;
    for(;j&bit;bit>>=1) j^=bit;
    j^=bit;
    if(i<j) { [real[i],real[j]]=[real[j],real[i]]; [imag[i],imag[j]]=[imag[j],imag[i]]; }
  }
  for(let width=2;width<=n;width*=2) {
    const angle=(inverse?2:-2)*Math.PI/width, stepR=Math.cos(angle), stepI=Math.sin(angle);
    for(let start=0;start<n;start+=width) {
      let wr=1,wi=0;
      for(let k=0;k<width/2;k++) {
        const left=start+k,right=left+width/2;
        const tr=wr*real[right]-wi*imag[right],ti=wr*imag[right]+wi*real[right];
        real[right]=real[left]-tr;imag[right]=imag[left]-ti;
        real[left]+=tr;imag[left]+=ti;
        const next=wr*stepR-wi*stepI;wi=wr*stepI+wi*stepR;wr=next;
      }
    }
  }
  if(inverse) for(let i=0;i<n;i++) {real[i]/=n;imag[i]/=n;}
}
export function correlationSums(a: Float32Array,b: Float32Array): Float64Array {
  let size=1;while(size<a.length+b.length-1) size*=2;
  const ar=new Float64Array(size),ai=new Float64Array(size),br=new Float64Array(size),bi=new Float64Array(size);
  ar.set(a);for(let i=0;i<b.length;i++) br[i]=b[b.length-1-i];
  fft(ar,ai,false);fft(br,bi,false);
  for(let i=0;i<size;i++) {const r=ar[i]*br[i]-ai[i]*bi[i];ai[i]=ar[i]*bi[i]+ai[i]*br[i];ar[i]=r;}
  fft(ar,ai,true);return ar;
}
