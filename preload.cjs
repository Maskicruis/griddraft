'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('grid',Object.fromEntries(['demo','draw','edit','open','save','svg','dirty'].map(name=>[
  name,async(...args)=>{
    const result=await ipcRenderer.invoke('grid:'+name,...args);
    if(!result.ok)throw Object.assign(new Error(result.error),{code:result.code});
    return result.value;
  }
])));
