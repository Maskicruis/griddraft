'use strict';

const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const {realpathSync}=require('node:fs');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const {Worker}=require('node:worker_threads');
const {randomUUID}=require('node:crypto');
const engine=require('./src/engine.cjs');
const demo=require('./examples/fuyu-demo.json');
const page=path.join(__dirname,'ui','index.html');
const canonical=p=>{const real=realpathSync.native(p);return process.platform==='win32'?real.toLowerCase():real;};
const canonicalPage=canonical(page);
let window;

if(process.argv.includes('--isolated-test')){
  const directory=process.argv.find(arg=>arg.startsWith('--workspace='));
  if(directory)app.setPath('userData',path.resolve(directory.slice(12)));
}
function trusted(url){try{return canonical(fileURLToPath(url))===canonicalPage;}catch{return false;}}
function route(name,action){
  ipcMain.handle('grid:'+name,async(event,...args)=>{
    if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame||!trusted(event.senderFrame.url))
      return {ok:false,error:'请求来源无效。'};
    try{return {ok:true,value:await action(...args)};}
    catch(e){return {ok:false,error:e.message,code:e.code};}
  });
}
function draw(graph,options){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'src','worker.cjs'),{workerData:{graph,options},resourceLimits:{maxOldGenerationSizeMb:256}});
    const timer=setTimeout(()=>{
      worker.terminate();
      reject(new Error('计算超时，请缩小网络规模。'));
    },30000);
    worker.once('message',data=>data.error?reject(Object.assign(new Error(data.error),{code:data.code})):resolve(data.result));
    worker.once('error',reject);
    worker.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('排版进程提前退出。'));});
  });
}
async function write(file,value){
  const temp=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temp,value,{flag:'wx',encoding:'utf8'});
  try{await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}
app.whenReady().then(async()=>{
  route('demo',()=>demo);
  route('draw',draw);
  route('edit',engine.edit);
  route('open',async()=>{
    const result=await dialog.showOpenDialog(window,{properties:['openFile'],title:'打开网络图',filters:[{name:'GridDraft JSON',extensions:['json']}]});
    if(result.canceled)return null;
    const file=result.filePaths[0];
    if((await fs.stat(file)).size>32*1024*1024)throw Error('图文件超过 32 MiB。');
    return {graph:engine.normalize(JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''))),file};
  });
  route('save',async(graph,known)=>{
    const checked=engine.normalize(graph);
    let file=known;
    if(!file){
      const result=await dialog.showSaveDialog(window,{defaultPath:'network.json',filters:[{name:'GridDraft JSON',extensions:['json']}]});
      if(result.canceled)return null;
      file=result.filePath;
    }
    await write(file,JSON.stringify(checked,null,2)+'\n');
    return file;
  });
  route('svg',async(graph,critical)=>{
    const result=await dialog.showSaveDialog(window,{defaultPath:'network.svg',filters:[{name:'SVG',extensions:['svg']}]});
    if(result.canceled)return false;
    await write(result.filePath,(await draw(graph,{critical:critical===true})).svg);
    return true;
  });
  window=new BrowserWindow({title:'GridDraft 网络图工作台',width:1430,height:900,minWidth:980,minHeight:670,backgroundColor:'#f2f6fb',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.removeMenu();
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!trusted(url))event.preventDefault();});
  window.on('close',event=>{
    if(!dirty)return;
    const choice=dialog.showMessageBoxSync(window,{type:'question',title:'关闭 GridDraft',message:'当前网络图有未保存的更改。',buttons:['取消','放弃更改'],defaultId:0,cancelId:0});
    if(choice!==1)event.preventDefault();
  });
  await window.loadFile(page);
}).catch(error=>{dialog.showErrorBox('GridDraft 启动失败',error.message);app.quit();});
let dirty=false;
route('dirty',value=>{dirty=value===true;});
app.on('window-all-closed',()=>app.quit());
