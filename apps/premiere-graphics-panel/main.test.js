import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {validateMogrtPreviewRequest} from '../../adapters/premiere/src/uxp-mogrt.ts';
import * as textModule from '../../adapters/premiere/src/uxp-mogrt-text.ts';

// Exercise panel event wiring/state with host/file boundaries replaced. No claim
// about UXP's layout or 27.x native rendering is made by these Node tests.
function panel(supported=true,writeVerified=textModule.MOGRT_TEXT_WRITE_VERIFIED) {
  const nodes=new Map(),handlers=new Map(),selectedFiles=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,children:[],
    addEventListener:(event,fn)=>handlers.set(`${id}:${event}`,fn),
    appendChild(option){this.children.push(option);},replaceChildren(){this.children=[];}});return nodes.get(id);};
  let setup,edits=[],editStatus='text-updated';
  const target={componentIndex:2,componentMatchName:'Text',parameterIndex:0,parameterName:'제목',
    before:{text:'원본',fontName:'Font',fontSize:48},fontNameEditable:false,fontSizeEditable:true};
  const targets=[target];
  const fakeText={...textModule,MOGRT_TEXT_WRITE_VERIFIED:writeVerified,inspectPremiereMogrtText:async()=>({status:'ready',targets,skipped:[]}),
    applyPremiereMogrtText:async(_api,_inspection,index,input)=>{edits.push({index,input});return {status:editStatus,graphicsApplied:false};}};
  const preview={status:'preview-created',projectId:'p',sequenceId:'s',decisionId:'manual-preview',items:[{name:'Title'}]};
  const ppro={MogrtText:supported?class {}:undefined,Project:{getActiveProject:async()=>({guid:{toString:()=> 'p'}})}};
  runInNewContext(readFileSync(new URL('./main.js',import.meta.url),'utf8'),{
    document:{getElementById:node,createElement:()=>({value:'',textContent:''})},
    require:name=>{
      if(name==='uxp')return {entrypoints:{setup:v=>{setup=v;}},storage:{localFileSystem:{getFileForOpening:async()=>selectedFiles.shift()}}};
      if(name==='premierepro')return ppro;
      if(name==='./uxp-mogrt.js')return {validateMogrtPreviewRequest,previewPremiereMogrt:async()=>({...preview})};
      if(name==='./uxp-mogrt-text.js')return fakeText;
      throw Error(name);
    },
  });
  setup.panels['graphics-preview'].show();
  const event=async(id,event='click')=>{const fn=handlers.get(`${id}:${event}`);if(fn)await fn();};
  const create=async()=>{selectedFiles.push({name:'Title.mogrt',nativePath:'/Title.mogrt'});await event('template');await event('preview');};
  return {node,event,create,selectedFiles,edits,targets,setStatus:s=>{editStatus=s;}};
}
describe('editable text panel',()=>{
  it('keeps production text inspection available but blocks writes even if the click handler is invoked',async()=>{
    const p=panel();await p.create();
    expect(p.node('inspect-text').disabled).toBe(false);
    await p.event('inspect-text');p.node('text-target').value='0';await p.event('text-target','change');
    expect(p.node('caption-text').value).toBe('원본');
    for(const id of ['caption-text','font-name','font-size','apply-text'])expect(p.node(id).disabled).toBe(true);
    p.node('caption-text').value='직접 입력';await p.event('apply-text');
    expect(p.edits).toEqual([]);
    expect(p.node('status').textContent).toContain('적용은 중지');
    expect(JSON.parse(p.node('result').value).textEdits).toBeUndefined();
    expect(p.node('inspect-text').disabled).toBe(false);
  });
  it('keeps editing disabled on hosts without the text API while retaining preview',async()=>{
    const p=panel(false);await p.create();
    expect(p.node('inspect-text').disabled).toBe(true);
    expect(p.node('apply-text').disabled).toBe(true);
    expect(p.node('text-help').textContent).toContain('27.0');
    expect(JSON.parse(p.node('result').value).status).toBe('preview-created');
  });
  it('requires explicit target selection and preserves unspecified font settings',async()=>{
    const p=panel(true,true);await p.create();await p.event('inspect-text');
    expect(p.node('apply-text').disabled).toBe(true);
    p.node('text-target').value='0';await p.event('text-target','change');
    expect(p.node('font-name').disabled).toBe(true);
    expect(p.node('font-size').disabled).toBe(false);
    p.node('caption-text').value='새 문구';await p.event('apply-text');
    expect(p.edits).toEqual([{index:0,input:{text:'새 문구'}}]);
    expect(p.node('apply-text').disabled).toBe(true);
    expect(JSON.parse(p.node('result').value).textEdits[0].status).toBe('text-updated');
  });
  it('distinguishes identical text parameters within the same component',async()=>{
    const p=panel(true,true);p.targets.push({...p.targets[0],parameterIndex:1});
    await p.create();await p.event('inspect-text');
    const options=p.node('text-target').children.slice(1);
    expect(options).toHaveLength(2);
    expect(options[0].textContent).not.toBe(options[1].textContent);
    p.node('text-target').value=options[1].value;await p.event('text-target','change');await p.event('apply-text');
    expect(p.edits[0].index).toBe(1);
  });
  it('loads a caption draft and clears its live target binding when another template is selected',async()=>{
    const p=panel();const draft={schemaVersion:'1.0.0',mode:'editable-text-draft',edit:{text:'계획 문구'},preview:{schemaVersion:'1.0.0',mode:'template-preview',decisionId:'a',templateId:'t',templateVersion:'1',templatePath:'/t.mogrt',startTicks:'0',durationTicks:'254016000000',frameTicks:'8467200000',canvas:{width:1920,height:1080}}};
    p.selectedFiles.push({getMetadata:async()=>({size:1000}),read:async()=>JSON.stringify(draft)});await p.event('request');
    await p.create();await p.event('inspect-text');p.node('text-target').value='0';await p.event('text-target','change');
    expect(p.node('caption-text').value).toBe('계획 문구');
    p.selectedFiles.push({name:'Other.mogrt',nativePath:'/other.mogrt'});await p.event('template');
    expect(p.node('apply-text').disabled).toBe(true);
    expect(p.node('text-target').value).toBe('');
  });
  it('requires manual review after an uncertain write and prevents reinspection/retry',async()=>{
    const p=panel(true,true);await p.create();await p.event('inspect-text');p.node('text-target').value='0';await p.event('text-target','change');
    p.setStatus('needs-review');await p.event('apply-text');
    expect(p.node('inspect-text').disabled).toBe(true);
    expect(p.node('apply-text').disabled).toBe(true);
    expect(p.node('status').textContent).toContain('확인');
  });
});
