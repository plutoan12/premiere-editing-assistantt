import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildTimecodeSyncGroup } from '@pea/sync';
import type { SyncGroup } from '@pea/sync';
import type { MediaInfo } from '@pea/media-ffmpeg';
import * as adapter from './index.js';
const rate={rate:{numerator:24,denominator:1},dropFrame:false};
const group=()=>buildTimecodeSyncGroup('g',[{clipId:'a',timecodeTicks:0n,clockId:'jam',frameRate:rate},{clipId:'b',timecodeTicks:24n,clockId:'jam',frameRate:rate}]);
const info=(path:string):MediaInfo=>({path,durationSeconds:4,startSeconds:0,size:1024,mtimeMs:0,
  video:{index:0,width:1920,height:1080,frameRate:rate,vfrSuspected:false,startSeconds:0},
  audio:[{index:1,channels:2,sampleRate:48000,startSeconds:0}]});
const sources=()=>[{clipId:'a',media:info('/tmp/카메라 & A.mov')},{clipId:'b',media:{...info('/tmp/B.wav'),video:undefined}}];
const options={name:'Sync & Scene',frameRate:rate,width:1920,height:1080};

test('builds separate video/audio tracks with exact placement and no source trims',()=>{
  const plan=adapter.buildPremiereSyncPlan(group(),sources(),options);
  assert.deepEqual(plan.clips.map(c=>c.startFrame),[0,24]);assert.deepEqual(plan.clips.map(c=>c.durationFrames),[96,96]);
  assert.equal(plan.durationFrames,120);assert.equal(plan.mode,'add-new-sequence');assert.equal(plan.approved,false);
});
test('negative placements translate the whole group into a nonnegative timeline',()=>{
  const g=group();g.members[1].offset.ticks=-24n;g.members[1].offsetTicks=-24n;g.candidates[0].offset!.ticks=-24n;
  const plan=adapter.buildPremiereSyncPlan(g,sources(),options);assert.deepEqual(plan.clips.map(c=>c.startFrame),[24,0]);
});
test('fractional offsets fail by default and explicit nearest-frame policy reports residual',()=>{
  const g=group();g.members[1].offset={ticks:101n,timebase:{numerator:1,denominator:8000}};g.members[1].offsetTicks=101n;g.candidates[0].offset=g.members[1].offset;
  assert.throws(()=>adapter.buildPremiereSyncPlan(g,sources(),options),/fractional|rounding/);
  const plan=adapter.buildPremiereSyncPlan(g,sources(),{...options,rounding:'nearest'});
  assert.equal(plan.clips[1].startFrame,0);assert.ok(Math.abs(plan.clips[1].roundingErrorSeconds+.012625)<1e-10);
  assert.ok(plan.warnings.some(w=>w.code==='FRAME_ROUNDING'));
});
test('review and partial groups cannot silently turn into an applied sequence',()=>{
  for(const status of ['review','partial'] as const)assert.throws(()=>adapter.buildPremiereSyncPlan({...group(),status},sources(),options),/matched/);
});
test('unknown media, duplicate members and missing candidate evidence are rejected',()=>{
  assert.throws(()=>adapter.buildPremiereSyncPlan(group(),sources().slice(0,1),options),/media/);
  const g=group();g.members.push(g.members[1]);assert.throws(()=>adapter.buildPremiereSyncPlan(g,sources(),options),/duplicate/);
  assert.throws(()=>adapter.buildPremiereSyncPlan({...group(),candidates:[]},sources(),options),/candidate/);
});
test('mismatched fps, suspected VFR and a nonzero video start fail closed',()=>{
  const s=sources();s[0].media.video!.frameRate={rate:{numerator:25,denominator:1},dropFrame:false};
  assert.throws(()=>adapter.buildPremiereSyncPlan(group(),s,options),/frame rate/);
  s[0].media.video!.frameRate=rate;s[0].media.video!.vfrSuspected=true;assert.throws(()=>adapter.buildPremiereSyncPlan(group(),s,options),/VFR/);
  s[0].media.video!.vfrSuspected=false;s[0].media.video!.startSeconds=.5;assert.throws(()=>adapter.buildPremiereSyncPlan(group(),s,options),/video start/);
});
test('XML escapes Korean names/paths, declares xmeml and only adds a new sequence',()=>{
  const xml=adapter.renderPremiereXml(adapter.buildPremiereSyncPlan(group(),sources(),options));
  assert.match(xml,/<xmeml version="5">/);assert.match(xml,/<name>Sync &amp; Scene<\/name>/);
  assert.ok(xml.includes('file:///tmp/%EC%B9%B4%EB%A9%94%EB%9D%BC%20&amp;%20A.mov'));
  assert.match(xml,/<updatebehavior>add<\/updatebehavior>/);assert.ok(!xml.includes('replace'));
});
test('XML retains both audio channels, native audio sample rate and linked video',()=>{
  const xml=adapter.renderPremiereXml(adapter.buildPremiereSyncPlan(group(),sources(),options));
  assert.equal((xml.match(/<clipitem /g)||[]).length,5);assert.ok(xml.includes('<samplerate>48000</samplerate>'));
  assert.ok(xml.includes('<trackindex>2</trackindex>'));assert.ok(xml.includes('<linkclipref>clip-1-video</linkclipref>'));
});
test('NTSC output preserves rational rate with ntsc flag rather than fake 30 fps',()=>{
  const ntsc={rate:{numerator:30000,denominator:1001},dropFrame:true};
  const g=buildTimecodeSyncGroup('n',[{clipId:'a',timecodeTicks:0n,clockId:'jam',frameRate:ntsc},{clipId:'b',timecodeTicks:30n,clockId:'jam',frameRate:ntsc}]);
  const s=sources();s[0].media.video!.frameRate=ntsc;const p=adapter.buildPremiereSyncPlan(g,s,{...options,frameRate:ntsc});
  assert.equal(p.clips[1].startFrame,30);assert.match(adapter.renderPremiereXml(p),/<timebase>30<\/timebase><ntsc>TRUE<\/ntsc>/);
});
test('rejects invalid XML text, nonlocal media, zero duration and mismatched candidate offsets',()=>{
  assert.throws(()=>adapter.buildPremiereSyncPlan(group(),sources(),{...options,name:'bad\0name'}),/XML/);
  const s=sources();s[0].media.path='https://example.com/a.mov';assert.throws(()=>adapter.buildPremiereSyncPlan(group(),s,options),/local/);
  s[0].media.path='/a.mov';s[0].media.durationSeconds=0;assert.throws(()=>adapter.buildPremiereSyncPlan(group(),s,options),/duration/);
  const g=group();g.candidates[0].offset!.ticks=2n;assert.throws(()=>adapter.buildPremiereSyncPlan(g,sources(),options),/candidate/);
});
test('only reference audio is monitored by default to avoid summing camera scratch tracks',()=>{
  const plan=adapter.buildPremiereSyncPlan(group(),sources(),options);
  assert.equal(plan.monitorClipId,'a');
  const xml=adapter.renderPremiereXml(plan);assert.equal((xml.match(/<enabled>FALSE<\/enabled>/g)||[]).length,2);
});
test('a silent reference camera uses the first available audio source for monitoring',()=>{
  const s=sources();s[0].media.audio=[];const plan=adapter.buildPremiereSyncPlan(group(),s,options);
  assert.equal(plan.monitorClipId,'b');
});
