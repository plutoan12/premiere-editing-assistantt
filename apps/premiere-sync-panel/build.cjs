'use strict';
const {mkdir,copyFile}=require('node:fs/promises');
const {join}=require('node:path');
const files=['manifest.json','index.html','style.css','main.js','client.js','controller.js','selection.js','README.md'];
(async()=>{
  const dest=join(__dirname,'dist');await mkdir(dest,{recursive:true});
  for(const file of files)await copyFile(join(__dirname,file),join(dest,file));
  console.log('Prepared development UXP folder; not a signed CCX installer.');
})().catch(()=>{console.error('Panel staging failed');process.exitCode=1});
