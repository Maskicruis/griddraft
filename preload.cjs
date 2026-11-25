'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const routes=['demo','draw','edit','open','save','svg','networkData','dirty','modelSettings','modelSave','modelTest',
  'agentRun','agentStop','agentReset','agentApply','agentPreview','updateCheck','updateDownload','updateReveal','releasePage',
  'projectTemplates','projectParse','projectGenerate','projectImport','projectSave'];
const api=Object.fromEntries(routes.map(name=>[
  name,async(...args)=>{
    const result=await ipcRenderer.invoke('grid:'+name,...args);
    if(!result.ok)throw Object.assign(new Error(result.error),{code:result.code});
    return result.value;
  }
]));
for(const name of ['agentEvent','updateProgress']){
  api[name]=callback=>{
    const listener=(_event,data)=>callback(data);
    ipcRenderer.on('grid:'+name,listener);
    return ()=>ipcRenderer.removeListener('grid:'+name,listener);
  };
}
contextBridge.exposeInMainWorld('grid',api);
