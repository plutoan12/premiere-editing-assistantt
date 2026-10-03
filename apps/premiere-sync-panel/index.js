const {entrypoints,storage}=require('uxp');
const {createImportController}=require('./import-controller.js');
const controller=createImportController(require('premierepro'));
const select=document.getElementById('select'),approve=document.getElementById('approve'),apply=document.getElementById('apply');
const preview=document.getElementById('preview'),status=document.getElementById('status');let selected=false,working=false;
function refresh(){apply.disabled=!selected||!approve.checked||working;select.disabled=working;approve.disabled=working;}
select.addEventListener('click',async()=>{
  selected=false;approve.checked=false;working=true;refresh();
  try{const file=await storage.localFileSystem.getFileForOpening({types:['xml']});if(!file){preview.textContent='선택 취소';return;}
    const info=await controller.inspect(file);selected=true;preview.textContent=`${info.filename}\n새 시퀀스 ${info.sequenceCount}개 · 클립 항목 ${info.clipItems}개`;
    status.textContent='현재 프로젝트가 맞는지 확인한 뒤 승인해. XML 구조의 Premiere 호환성은 가져오기 후 검수가 필요해.';
  }catch(error){status.textContent=error.message||String(error);}finally{working=false;refresh();}
});
approve.addEventListener('change',refresh);
apply.addEventListener('click',async()=>{
  working=true;refresh();try{const result=await controller.apply(approve.checked);selected=false;approve.checked=false;
    status.textContent=`${result.projectName}: 새 시퀀스 ${result.addedSequences}개 가져옴. 자동 저장하지 않았어. 미디어 연결·트랙·싱크를 확인해.`;
  }catch(error){selected=false;approve.checked=false;status.textContent=error.message||String(error);}finally{working=false;refresh();}
});
entrypoints.setup({panels:{peaSyncImport:{show(){refresh();}}}});
