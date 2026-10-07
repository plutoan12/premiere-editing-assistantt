'use strict';
const {entrypoints,storage}=require('uxp');
const ppro=require('premierepro');
const {previewPremiereMogrt,validateMogrtPreviewRequest}=require('./uxp-mogrt.js');
const fs=storage.localFileSystem;
let template=null,projectId=null,receipt=null,busy=false,installed=false;
let request={schemaVersion:'1.0.0',mode:'template-preview',decisionId:'manual-preview',templateId:'selected-template',templateVersion:'unverified',templatePath:'/selected.mogrt',startTicks:'508540032000',durationTicks:'254270016000',frameTicks:'8475667200',canvas:{width:1920,height:1080}};
const el=id=>document.getElementById(id);
function buttons(){for(const id of ['template','request'])el(id).disabled=busy;el('preview').disabled=busy||!template||!projectId||Boolean(receipt);el('inspect').disabled=busy||!receipt?.sequenceId;el('export').disabled=busy||!receipt;}
function show(value){el('result').value=JSON.stringify(value,null,2);}
function guard(work){return async()=>{if(busy)return;busy=true;buttons();try{await work();}catch(error){const message=String(error?.message||'');el('status').textContent='완료하지 못했습니다. '+(/^[A-Z_]{1,64}$/.test(message)?message:'HOST_OR_FILE_ERROR');}finally{busy=false;buttons();}};}
async function pickTemplate(){
  const selected=await fs.getFileForOpening({types:['mogrt']});if(!selected)return;
  const project=await ppro.Project.getActiveProject();if(!project)throw Error('OPEN_PROJECT_FIRST');
  validateMogrtPreviewRequest({...request,templatePath:selected.nativePath});
  template=selected;projectId=project.guid.toString();receipt=null;
  el('status').textContent=selected.name+' · 선택됨';
}
async function loadRequest(){
  const file=await fs.getFileForOpening({types:['json']});if(!file)return;
  if((await file.getMetadata()).size>65536)throw Error('REQUEST_TOO_LARGE');
  const input=await file.read();if(input.length>65536)throw Error('REQUEST_TOO_LARGE');
  request=validateMogrtPreviewRequest(JSON.parse(input));receipt=null;template=null;projectId=null;
  el('summary').textContent=request.decisionId+' · '+request.canvas.width+'×'+request.canvas.height+' · 계획의 시작과 길이로 미리보기';
  el('status').textContent='계획을 읽었습니다. 해당 버전의 MOGRT를 선택하세요. 파일 버전은 자동 판별하지 않습니다.';
}
async function preview(){
  if(!template||!projectId||receipt)throw Error('SELECT_TEMPLATE_FIRST');
  el('status').textContent='새 시퀀스에 템플릿을 넣는 중…';
  receipt=await previewPremiereMogrt(ppro,{...request,templatePath:template.nativePath},projectId);
  show(receipt);el('status').textContent=receipt.status==='preview-created'?'원본 템플릿 미리보기 완료 · 자막 계획은 미적용':'일부 변경이 남았을 수 있습니다. 결과의 시퀀스를 확인하세요. 자동 재시도하지 않습니다.';
}
async function inspect(){
  const project=await ppro.Project.getActiveProject();if(!project||project.guid.toString()!==projectId)throw Error('PROJECT_CHANGED');
  const sequence=(await project.getSequences()).find(s=>s.guid.toString()===receipt.sequenceId);if(!sequence)throw Error('SEQUENCE_MISSING');
  const items=(await sequence.getVideoTrack(0)).getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
  const components=[];
  for(const item of items){const chain=await item.getComponentChain();for(let i=0;i<chain.getComponentCount();i++){
    const component=chain.getComponentAtIndex(i),params=[];
    for(let j=0;j<component.getParamCount();j++){
      const param=component.getParam(j);let type='unavailable';
      try{const key=await param.getStartValue();const wrapped=key?.value;
        if(key===null||key===undefined||wrapped===null)type='unavailable';
        else if(wrapped&&typeof wrapped==='object'&&'value' in wrapped){const value=wrapped.value;type=value===null||value===undefined?'unavailable':Array.isArray(value)?'array':typeof value;}
        else type='host-object'; // Color and newer text objects need a template-specific inspector.
      }catch{}
      params.push({index:j,name:param.displayName,type});
    }
    components.push({matchName:await component.getMatchName(),parameters:params});
  }}
  receipt={...receipt,components};show(receipt);
  el('status').textContent='현재 노출된 속성을 읽었습니다. AE 템플릿은 로딩 후 다시 확인할 수 있습니다.';
}
async function exportReceipt(){const file=await fs.getFileForSaving('pea-graphics-preview.json',{types:['json']});if(file)await file.write(JSON.stringify(receipt,null,2));}
entrypoints.setup({panels:{'graphics-preview':{show(){if(installed)return;installed=true;
  for(const [id,work] of [['template',pickTemplate],['request',loadRequest],['preview',preview],['inspect',inspect],['export',exportReceipt]])el(id).addEventListener('click',guard(work));buttons();
}}}});
