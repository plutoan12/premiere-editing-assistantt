import type { SequencePlan, MediaTime } from '@pea/core';
import { validateDescriptor, type MediaDescriptor, type Rate } from '@pea/rough-media/wire';
export function xmlText(s: string): string {
  if (typeof s !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) throw new Error('invalid XML text');
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function frames(t: MediaTime, rate: Rate): bigint {
  if (!t || typeof t.ticks !== 'bigint' || t.ticks < 0n || ![t.timebase?.numerator, t.timebase?.denominator].every(x => Number.isSafeInteger(x) && x > 0)) throw new Error('invalid plan time');
  const n = t.ticks * BigInt(t.timebase.numerator) * BigInt(rate.numerator), d = BigInt(t.timebase.denominator) * BigInt(rate.denominator);
  if (n % d) throw new Error('plan time is not frame aligned'); return n / d;
}
/** Adapted from existing Sync xml.ts (8d58b53), with multiple ranges per track. */
export function renderRoughXml(plan: SequencePlan, input: MediaDescriptor, clipId: string): string {
  const m = validateDescriptor(input), r = m.frameRate;
  const key = `${r.numerator}/${r.denominator}`;
  if (!['24/1','25/1','30/1','50/1','60/1','120/1','24000/1001','30000/1001','60000/1001'].includes(key)) throw new Error('unsupported interchange frame rate');
  if (!plan || !/^[A-Za-z0-9_-]{1,80}$/.test(plan.id) || !plan.name?.trim() || plan.name.length > 200 || !Array.isArray(plan.decisions) || !plan.decisions.length || plan.decisions.length > 2000) throw new Error('invalid rough plan');
  let end = 0n, previousOut = 0n; const ids = new Set<string>();
  const cuts = plan.decisions.map(d => {
    if (!d || typeof d.id !== 'string' || !d.id || ids.has(d.id) || d.clipId !== clipId) throw new Error('invalid clip decision'); ids.add(d.id);
    const start = frames(d.sourceRange.start,r), duration = frames(d.sourceRange.duration,r), destination = frames(d.destination,r);
    if (duration <= 0n || start < previousOut || start + duration > BigInt(m.durationFrames) || destination !== end) throw new Error('noncontiguous/out-of-bounds plan');
    previousOut = start + duration; end += duration; return { start, out:start+duration, destination, end };
  });
  const rate = `<rate><timebase>${Math.round(r.numerator/r.denominator)}</timebase><ntsc>${r.denominator===1001?'TRUE':'FALSE'}</ntsc></rate>`;
  const video = `<samplecharacteristics>${rate}<width>${m.width}</width><height>${m.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics>`;
  const pathUrl = 'file://localhost' + m.path.split('/').map(encodeURIComponent).join('/');
  const audioFormat = `<samplecharacteristics><samplerate>${m.sourceSampleRate}</samplerate></samplecharacteristics>`;
  const name=xmlText(m.path.split('/').at(-1) ?? 'media');
  let fileWritten=false;
  const source=()=>{if(fileWritten)return '<file id="pea-source"/>';fileWritten=true;return `<file id="pea-source"><name>${name}</name><pathurl>${xmlText(pathUrl)}</pathurl>${rate}<duration>${m.durationFrames}</duration><media><video>${video}</video><audio>${audioFormat}<channelcount>${m.channels}</channelcount></audio></media></file>`;};
  const item=(cut:typeof cuts[number],i:number,ch:number)=>{
    const type=ch===0?'video':'audio';
    const links=Array.from({length:m.channels+1},(_,c)=>`<link><linkclipref>rc-${i}-${c}</linkclipref><mediatype>${c===0?'video':'audio'}</mediatype><trackindex>${c||1}</trackindex><clipindex>${i+1}</clipindex>${c?'<groupindex>1</groupindex>':''}</link>`).join('');
    return `<clipitem id="rc-${i}-${ch}"><name>${name}</name><enabled>TRUE</enabled><duration>${m.durationFrames}</duration>${rate}<start>${cut.destination}</start><end>${cut.end}</end><in>${cut.start}</in><out>${cut.out}</out>${source()}<sourcetrack><mediatype>${type}</mediatype><trackindex>${ch||1}</trackindex></sourcetrack>${links}</clipitem>`;
  };
  const track=(ch:number)=>`<track>${cuts.map((c,i)=>item(c,i,ch)).join('')}<enabled>TRUE</enabled><locked>FALSE</locked>${ch?`<outputchannelindex>${ch}</outputchannelindex>`:''}</track>`;
  const vtrack=track(0),atracks=Array.from({length:m.channels},(_,c)=>track(c+1)).join('');
  const outputs=`<outputs><group><index>1</index><numchannels>${m.channels}</numchannels><downmix>0</downmix>${Array.from({length:m.channels},(_,c)=>`<channel><index>${c+1}</index></channel>`).join('')}</group></outputs>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xmeml version="5"><sequence id="${xmlText(plan.id)}"><name>${xmlText(plan.name)}</name><duration>${end}</duration>${rate}<timecode>${rate}<frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><format>${video}</format>${vtrack}</video><audio><format><samplecharacteristics><samplerate>48000</samplerate></samplecharacteristics></format>${outputs}${atracks}</audio></media><updatebehavior>add</updatebehavior></sequence></xmeml>\n`;
}
