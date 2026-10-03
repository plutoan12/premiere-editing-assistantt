import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { frameTimebase } from '@pea/sync';
import type { PremiereSyncPlan, PremiereClip } from './plan.js';
import { xmlText as esc } from './plan.js';
/** FCP7 xmeml (NOT FCPX fcpxml). Frame-level interchange; no source writes. */
export function renderPremiereXml(plan:PremiereSyncPlan):string {
  if(plan.schemaVersion!=='1.0.0'||plan.mode!=='add-new-sequence'||plan.approved!==false)throw new Error('invalid dry-run plan');
  const tb=frameTimebase(plan.frameRate),nominal=Math.round(tb.denominator/tb.numerator),ntsc=tb.numerator===1001;
  const rate=`<rate><timebase>${nominal}</timebase><ntsc>${ntsc?'TRUE':'FALSE'}</ntsc></rate>`;
  const sampleVideo=(width:number,height:number)=>`<samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics>`;
  type Entry={id:string;type:'video'|'audio';track:number;channel?:number;clip:PremiereClip;file:number};
  const entries:Entry[]=[],sets:Entry[][]=[];let vt=0,at=0;
  plan.clips.forEach((clip,i)=>{
    const set:Entry[]=[];
    if(clip.media.video)set.push({id:`clip-${i+1}-video`,type:'video',track:++vt,clip,file:i+1});
    const count=clip.media.audio.reduce((n,s)=>n+s.channels,0);
    for(let ch=1;ch<=count;ch++)set.push({id:`clip-${i+1}-audio-${ch}`,type:'audio',track:++at,channel:ch,clip,file:i+1});
    entries.push(...set);sets.push(set);
  });
  const defined=new Set<number>();
  function file(entry:Entry):string {
    const id=`file-${entry.file}`;if(defined.has(entry.file))return `<file id="${id}"/>`;defined.add(entry.file);
    const m=entry.clip.media,v=m.video,a=m.audio,count=a.reduce((n,s)=>n+s.channels,0);
    return `<file id="${id}"><name>${esc(basename(m.path))}</name><pathurl>${esc(pathToFileURL(m.path).href)}</pathurl>${rate}<duration>${entry.clip.durationFrames}</duration><media>`
      +(v?`<video>${sampleVideo(v.width,v.height)}</video>`:'')
      +(a.length?`<audio><samplecharacteristics><samplerate>${a[0].sampleRate}</samplerate></samplecharacteristics><channelcount>${count}</channelcount></audio>`:'')+'</media></file>';
  }
  function item(entry:Entry):string {
    const c=entry.clip,linked=sets[entry.file-1];
    const links=linked.map(e=>`<link><linkclipref>${e.id}</linkclipref><mediatype>${e.type}</mediatype><trackindex>${e.track}</trackindex><clipindex>1</clipindex></link>`).join('');
    return `<track><clipitem id="${entry.id}"><name>${esc(basename(c.media.path))}</name><enabled>TRUE</enabled><duration>${c.durationFrames}</duration>${rate}`
      +`<start>${c.startFrame}</start><end>${c.startFrame+c.durationFrames}</end><in>0</in><out>${c.durationFrames}</out>`
      +file(entry)+`<sourcetrack><mediatype>${entry.type}</mediatype><trackindex>${entry.channel??1}</trackindex></sourcetrack>`
      +`<logginginfo><description>${esc(c.clipId)}</description></logginginfo>`+links+`</clipitem><enabled>${entry.type==='audio'&&c.clipId!==plan.monitorClipId?'FALSE':'TRUE'}</enabled><locked>FALSE</locked></track>`;
  }
  const videos=entries.filter(e=>e.type==='video').map(item).join('\n'),audio=entries.filter(e=>e.type==='audio').map(item).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!-- PEA_SYNC_XML_V1: import as a new sequence; review sync before use. -->\n'
    +`<xmeml version="5"><sequence id="pea-sync-sequence"><name>${esc(plan.name)}</name><duration>${plan.durationFrames}</duration>${rate}`
    +`<timecode>${rate}<frame>0</frame><displayformat>${plan.frameRate.dropFrame?'DF':'NDF'}</displayformat></timecode>`
    +`<media><video><format>${sampleVideo(plan.width,plan.height)}</format>${videos}</video>`
    +`<audio><format><samplecharacteristics><samplerate>48000</samplerate></samplecharacteristics></format>${audio}</audio></media>`
    +'<updatebehavior>add</updatebehavior></sequence></xmeml>\n';
}
