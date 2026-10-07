'use strict';
const {entrypoints,storage}=require('uxp');
const ppro=require('premierepro');
const {previewPremiereMogrt,validateMogrtPreviewRequest}=require('./uxp-mogrt.js');
const {inspectPremiereMogrtText,applyPremiereMogrtText,validateMogrtTextDraft,MOGRT_TEXT_WRITE_VERIFIED}=require('./uxp-mogrt-text.js');
const writeBlockedMessage='문구를 읽을 수 있지만 적용은 중지되어 있습니다. Premiere 베타에서 적용 후 읽기 오류가 확인되었습니다.';
const fs=storage.localFileSystem;
let template=null,projectId=null,receipt=null,busy=false,installed=false;
let textInspection=null,textDraft=null,textReviewRequired=false;
let request={schemaVersion:'1.0.0',mode:'template-preview',decisionId:'manual-preview',templateId:'selected-template',templateVersion:'unverified',templatePath:'/selected.mogrt',startTicks:'508540032000',durationTicks:'254270016000',frameTicks:'8475667200',canvas:{width:1920,height:1080}};
const el=id=>document.getElementById(id);
function selectedTextTarget(){const value=el('text-target').value;return value===''?null:textInspection?.targets[Number(value)]||null;}
function buttons(){
  for(const id of ['template','request'])el(id).disabled=busy;
  el('preview').disabled=busy||!template||!projectId||Boolean(receipt);
  el('inspect').disabled=busy||!receipt?.sequenceId;el('export').disabled=busy||!receipt;
  el('inspect-text').disabled=busy||typeof ppro.MogrtText!=='function'||receipt?.status!=='preview-created'||textReviewRequired;
  el('text-target').disabled=busy||!textInspection?.targets.length||textReviewRequired;
  const target=selectedTextTarget(),disabled=busy||!target||textReviewRequired||MOGRT_TEXT_WRITE_VERIFIED!==true;
  el('caption-text').disabled=disabled;el('apply-text').disabled=disabled;
  el('font-name').disabled=disabled||!target?.fontNameEditable;
  el('font-size').disabled=disabled||!target?.fontSizeEditable;
}
function clearTextBinding(){textInspection=null;el('text-target').textContent='';el('text-target').value='';el('caption-text').value='';el('font-name').value='';el('font-size').value='';}
function show(value){el('result').value=JSON.stringify(value,null,2);}
function guard(work){return async()=>{if(busy)return;busy=true;buttons();try{await work();}catch(error){const message=String(error?.message||'');el('status').textContent='완료하지 못했습니다. '+(/^[A-Z_]{1,64}$/.test(message)?message:'HOST_OR_FILE_ERROR');}finally{busy=false;buttons();}};}
async function pickTemplate(){
  const selected=await fs.getFileForOpening({types:['mogrt']});if(!selected)return;
  const project=await ppro.Project.getActiveProject();if(!project)throw Error('OPEN_PROJECT_FIRST');
  validateMogrtPreviewRequest({...request,templatePath:selected.nativePath});
  template=selected;projectId=project.guid.toString();receipt=null;textReviewRequired=false;clearTextBinding();
  el('status').textContent=selected.name+' · 선택됨';
}
async function loadRequest(){
  const file=await fs.getFileForOpening({types:['json']});if(!file)return;
  if((await file.getMetadata()).size>65536)throw Error('REQUEST_TOO_LARGE');
  const input=await file.read();if(input.length>65536)throw Error('REQUEST_TOO_LARGE');
  const parsed=JSON.parse(input);
  if(parsed?.mode==='editable-text-draft'){const draft=validateMogrtTextDraft(parsed);request=draft.preview;textDraft=draft.edit;}
  else {request=validateMogrtPreviewRequest(parsed);textDraft=null;}
  receipt=null;template=null;projectId=null;textReviewRequired=false;clearTextBinding();
  el('summary').textContent=request.decisionId+' · '+request.canvas.width+'×'+request.canvas.height+' · 계획의 시작과 길이로 미리보기';
  el('status').textContent='계획을 읽었습니다. 해당 버전의 MOGRT를 선택하세요. 파일 버전은 자동 판별하지 않습니다.';
}
async function inspectText(){
  if(!receipt||textReviewRequired)throw Error('SUCCESSFUL_PREVIEW_REQUIRED');
  clearTextBinding();
  textInspection=await inspectPremiereMogrtText(ppro,receipt);
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='확인할 문구를 선택하세요';el('text-target').appendChild(placeholder);
  textInspection.targets.forEach((target,index)=>{const option=document.createElement('option');option.value=String(index);
    option.textContent='문구 '+(index+1)+' · '+target.parameterName+' · '+target.before.text.slice(0,40);el('text-target').appendChild(option);});
  el('text-target').value='';receipt={...receipt,textInspection};show(receipt);
  el('status').textContent=textInspection.status==='ready'?(MOGRT_TEXT_WRITE_VERIFIED===true?'수정할 문구를 선택하세요. 폰트 입력란을 비우면 현재 값을 유지합니다.':writeBlockedMessage):
    textInspection.status==='unsupported'?'이 Premiere에서는 문구 편집을 지원하지 않습니다.':'편집 가능한 문구가 없습니다. 템플릿 로딩 후 다시 확인하세요. 혼합 스타일과 애니메이션 문구는 제외됩니다.';
}
function selectTextTarget(){
  const target=selectedTextTarget();
  el('caption-text').value=target?(textDraft?.text??target.before.text):'';
  el('font-name').value=target?.fontNameEditable?(textDraft?.fontName??''):'';
  el('font-size').value=target?.fontSizeEditable?String(textDraft?.fontSize??''):'';
  el('current-font').textContent=target?'현재 폰트: '+target.before.fontName+' · 크기 '+target.before.fontSize:'';
  buttons();
}
async function applyText(){
  if(MOGRT_TEXT_WRITE_VERIFIED!==true){el('status').textContent=writeBlockedMessage;return;}
  if(!selectedTextTarget()||textReviewRequired)throw Error('INSPECTION_REQUIRED');
  const edit={text:el('caption-text').value};
  if(el('font-name').value.trim())edit.fontName=el('font-name').value.trim();
  if(el('font-size').value.trim())edit.fontSize=Number(el('font-size').value);
  const result=await applyPremiereMogrtText(ppro,textInspection,Number(el('text-target').value),edit);
  receipt={...receipt,textEdits:[...(receipt.textEdits||[]),result]};show(receipt);
  textReviewRequired=result.status==='needs-review';clearTextBinding();
  el('status').textContent=result.status==='text-updated'?'문구와 요청한 폰트 값을 적용하고 다시 읽어 확인했습니다. 모양·줄바꿈·배치는 화면에서 확인하세요.':
    result.status==='needs-review'?'일부 변경이 남았을 수 있습니다. Premiere에서 결과와 실행 취소 기록을 확인하세요.':'적용하지 않았습니다. 문구를 다시 확인하세요. '+result.code;
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
  for(const [id,work] of [['template',pickTemplate],['request',loadRequest],['preview',preview],['inspect',inspect],['inspect-text',inspectText],['apply-text',applyText],['export',exportReceipt]])el(id).addEventListener('click',guard(work));
  el('text-target').addEventListener('change',selectTextTarget);
  el('text-help').textContent=typeof ppro.MogrtText==='function'?(MOGRT_TEXT_WRITE_VERIFIED===true?'문구 편집을 사용할 수 있습니다. 먼저 새 시퀀스에 미리보기를 만드세요.':writeBlockedMessage):'문구 확인에는 Premiere 27.0 베타의 텍스트 기능이 필요합니다. 현재 버전에서는 원본 미리보기를 사용할 수 있습니다.';
  buttons();
}}}});
