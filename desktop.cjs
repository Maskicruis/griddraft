'use strict';

const {app,BrowserWindow,dialog,ipcMain,safeStorage,shell}=require('electron');
const fs=require('node:fs/promises');
const {realpathSync}=require('node:fs');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const {Worker}=require('node:worker_threads');
const {randomUUID}=require('node:crypto');
const engine=require('./src/engine.cjs');
const {createModelStore}=require('./src/settings.cjs');
const {checkUpdates,downloadUpdate,releasePage}=require('./src/update.cjs');
const demo=require('./examples/fuyu-demo.json');
const project=require('./src/project.cjs');
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
  const modelStore=createModelStore(app.getPath('userData'),safeStorage);
  let runningAgent=null;
  let agentSession=null,agentConfig='',resetAgent=true;
  let availableUpdate=null;
  let downloading=false;
  let downloadedPath=null;
  const notify=(stream,event)=>{
    if(window&&!window.isDestroyed())window.webContents.send('grid:'+stream,event);
  };
  route('modelSettings',async()=>({version:app.getVersion(),...await modelStore.settings()}));
  route('modelSave',form=>modelStore.save(form));
  route('modelTest',async form=>{
    const {runHarness}=await import('./src/harness.mjs');
    await runHarness(await modelStore.candidate(form),{question:'请回复 OK。'},{signal:AbortSignal.timeout(20000)});
    return true;
  });
  route('agentRun',async (graph,question,context)=>{
    if(runningAgent)throw Error('已有试算请求在运行。');
    if(typeof question!=='string'||!question.trim()||question.length>2500)throw Error('请填写 1 至 2500 字的施工计划问题。');
    const control=new AbortController();
    runningAgent=control;
    try{
      const credentials=await modelStore.credentials();
      const config=JSON.stringify(credentials);
      if(resetAgent||!agentSession||config!==agentConfig){
        await agentSession?.dispose();
        agentSession=null;
        const {createHarnessSession}=await import('./src/harness.mjs');
        agentSession=await createHarnessSession(credentials,{emit:event=>notify('agentEvent',event)});
        agentConfig=config;resetAgent=false;
      }
      return await agentSession.run({graph,question,context},{
        signal:AbortSignal.any([control.signal,AbortSignal.timeout(90000)]),
      });
    }finally{runningAgent=null;}
  });
  route('agentStop',()=>runningAgent?.abort(new Error('已停止本次请求。')));
  route('agentReset',()=>{resetAgent=true;runningAgent?.abort(new Error('已开始新对话。'));});
  route('agentApply',(graph,id)=>{
    if(runningAgent)throw Error('请等待本轮对话结束后应用。');
    if(!agentSession||resetAgent)throw Error('请先生成网络图草稿。');
    return agentSession.apply(graph,id);
  });
  route('agentPreview',async(graph,id)=>{
    if(!agentSession||resetAgent)throw Error('请先生成网络图草稿。');
    const candidate=agentSession.preview(graph,id);
    try{return await draw(candidate,{networkView:'time'});}
    catch(error){
      if(!['CYCLE','MISSING_DURATION','EMPTY_NETWORK'].includes(error.code))throw error;
      return draw(candidate,{});
    }
  });
  route('updateCheck',async()=>{
    if(downloading)throw Error('正在下载更新。');
    availableUpdate=null;
    const {hash,url,size,...display}=await checkUpdates(app.getVersion());
    if(display.available)availableUpdate={...display,hash,url,size};
    return display;
  });
  route('updateDownload',async()=>{
    if(!availableUpdate||downloading)throw Error('请先检查可用更新。');
    const update=availableUpdate;
    downloading=true;
    try{
      const result=await dialog.showSaveDialog(window,{title:'保存新版 GridDraft',defaultPath:update.name,filters:[{name:'Windows EXE',extensions:['exe']}]});
      if(result.canceled)return false;
      await downloadUpdate(update,result.filePath,percent=>notify('updateProgress',percent));
      downloadedPath=result.filePath;
      return true;
    }finally{downloading=false;}
  });
  route('updateReveal',()=>{if(downloadedPath)shell.showItemInFolder(downloadedPath);});
  route('releasePage',()=>shell.openExternal(releasePage));
  route('projectTemplates',options=>project.templates(options));
  route('projectParse',(text,format)=>project.parseProject(text,format));
  route('projectGenerate',brief=>project.generateProject(brief));
  route('excelRead',async(bytes,name)=>{
    if(!(bytes instanceof Uint8Array)||bytes.byteLength>16*1024*1024||typeof name!=='string')throw Error('Excel 导入数据无效或超过16 MiB。');
    const result=await new Promise((resolve,reject)=>{
      const worker=new Worker(path.join(__dirname,'src','excel-worker.cjs'),{workerData:{bytes,name},resourceLimits:{maxOldGenerationSizeMb:256}});
      const timer=setTimeout(()=>{worker.terminate();reject(Error('Excel 读取超时，请按单位工程拆分文件。'));},30000);
      worker.once('message',data=>data.error?reject(Error(data.error)):resolve(data.result));
      worker.once('error',error=>reject(Error('Excel 读取失败：'+error.message)));
      worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Excel 读取进程提前退出，请缩小文件后重试。'));});
    });
    await write(path.join(app.getPath('userData'),'excel-last-import.json'),JSON.stringify(result));
    return result;
  });
  route('excelAnalyze',(sheet,mapping,name)=>require('./src/excel.cjs').analyzeExcel(sheet,mapping,name));
  route('excelLast',async()=>{
    try{return JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'excel-last-import.json'),'utf8'));}
    catch{return null;}
  });
  route('excelSave',async(source)=>{
    const checked=require('./src/excel.cjs').normalizeSource(source);
    const result=await dialog.showSaveDialog(window,{title:'保存Excel原始导入资料',defaultPath:'excel-source.json',filters:[{name:'Excel导入资料 JSON',extensions:['json']}]});
    if(result.canceled)return false;
    await write(result.filePath,JSON.stringify({version:1,kind:'excel-source',...checked},null,2)+'\n');return true;
  });
  route('projectImport',async()=>{
    const result=await dialog.showOpenDialog(window,{title:'导入项目基本信息',properties:['openFile'],
      filters:[{name:'项目文字或表格',extensions:['txt','md','csv','tsv','json']}]});
    if(result.canceled)return null;
    const file=result.filePaths[0];
    if((await fs.stat(file)).size>2*1024*1024)throw Error('项目信息文件最大 2 MiB。');
    const bytes=await fs.readFile(file);
    const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':'utf-8';
    let content;
    try{content=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
    catch{throw Error('请将文件保存为 UTF-8 或 UTF-16LE 编码后导入。');}
    const extension=path.extname(file).slice(1).toLowerCase();
    return project.parseProject(content,['csv','tsv','json'].includes(extension)?extension:'auto');
  });
  route('projectSave',async(brief)=>{
    const checked=project.normalizeProject(brief);
    const result=await dialog.showSaveDialog(window,{title:'保存项目信息及工序模板',defaultPath:'project-brief.json',
      filters:[{name:'项目信息 JSON',extensions:['json']}]});
    if(result.canceled)return false;
    await write(result.filePath,JSON.stringify(checked,null,2)+'\n');
    return true;
  });
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
  route('svg',async(graph,view,unit)=>{
    const kind=['time','logic','summary'].includes(view)?view:null;
    const result=await dialog.showSaveDialog(window,{defaultPath:kind==='summary'?'module-summary.svg':kind?'activity-on-arrow.svg':'flow.svg',filters:[{name:'SVG',extensions:['svg']}]});
    if(result.canceled)return false;
    await write(result.filePath,(await draw(graph,{critical:view===true,networkView:kind,unit})).svg);
    return true;
  });
  route('networkData',async(graph,unit)=>{
    const data=(await draw(graph,{networkView:'time',unit})).network;
    const result=await dialog.showSaveDialog(window,{defaultPath:'activity-on-arrow.json',filters:[{name:'JSON',extensions:['json']}]});
    if(result.canceled)return false;
    await write(result.filePath,JSON.stringify(data,null,2)+'\n');
    return true;
  });
  window=new BrowserWindow({title:'GridDraft 网络图工作台',icon:path.join(__dirname,'ui','griddraft.ico'),width:1430,height:900,minWidth:980,minHeight:670,backgroundColor:'#f2f6fb',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.removeMenu();
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!trusted(url))event.preventDefault();});
  window.on('close',event=>{
    if(!dirty)return;
    const choice=dialog.showMessageBoxSync(window,{type:'question',title:'关闭 GridDraft',message:'当前网络图有未保存的更改。',buttons:['取消','放弃更改'],defaultId:0,cancelId:0});
    if(choice!==1)event.preventDefault();
  });
  window.on('closed',()=>runningAgent?.abort());
  await window.loadFile(page);
}).catch(error=>{dialog.showErrorBox('GridDraft 启动失败',error.message);app.quit();});
let dirty=false;
route('dirty',value=>{dirty=value===true;});
app.on('window-all-closed',()=>app.quit());
