'use strict';
const excelState={book:null,result:null,busy:false};
const excelFields={id:'原工作编号',name:'工作名称',duration:'工期',before:'前置工作',after:'后置工作',start:'计划开始',finish:'计划完成',role:'行类型',parent:'父工作编号'};
const excelAliases={id:['工作编号','原工作编号','任务编号','编号','id','taskid'],name:['工作名称','任务名称','工序名称','名称','name','taskname'],duration:['工期工日','工期天','持续时间','工期','duration','days'],before:['前置工作','紧前工作','前置任务','predecessors','before'],after:['后置工作','紧后工作','后置任务','successors','after'],start:['计划开始','开始日期','start'],finish:['计划完成','完成日期','finish'],role:['行类型','工作类型','任务类型','role'],parent:['父工作编号','父任务编号','父编号','parentid']};
async function excelRun(action){
  if(excelState.busy)return;
  excelState.busy=true;$('excelChoose').disabled=$('excelValidate').disabled=$('excelRestore').disabled=true;
  try{await action();}catch(error){statusLine('excelStatus',error.message,true);}
  finally{excelState.busy=false;$('excelChoose').disabled=$('excelValidate').disabled=$('excelRestore').disabled=false;}
}
function excelSheet(){return excelState.book?.sheets[Number($('excelSheet').value)];}
function excelColumnMap(){return Object.fromEntries(Array.from($('excelMapping').querySelectorAll('select')).map(input=>[input.name,Number(input.value)]));}
async function excelValidate(){
  const sheet=excelSheet();if(!sheet)return;
  const result=await api.excelAnalyze(sheet,excelColumnMap(),excelState.book.name);
  excelState.result=result;
  $('excelGenerate').disabled=!result.graph;
  statusLine('excelStatus','已读取 '+result.summary.records+' 条记录 · '+result.summary.tasks+' 条工序候选 · '+result.summary.groups+' 条汇总 · '+result.issues.length+' 项待核对'+(result.graph?' · 可生成网络':''),Boolean(result.issues.length));
  const messages=[...result.warnings,...result.issues.slice(0,80).map(issue=>(issue.row?'Excel第'+issue.row+'行：':'')+issue.message)];
  if(result.issues.length>80)messages.push('另有 '+(result.issues.length-80)+' 项，修正编号和字段后重新校验。');
  $('excelIssues').replaceChildren(...messages.map(message=>el('p',message)));
}
async function excelShowSheet(){
  const sheet=excelSheet();if(!sheet)return;
  $('excelMapping').replaceChildren(...Object.entries(excelFields).map(([key,name])=>{
    const label=el('label',name),select=el('select');select.name=key;
    select.add(new Option('未选择',-1));
    for(const [index,value] of sheet.headers.entries())select.add(new Option(String.fromCharCode(65+index)+' · '+(value||'空表头'),index));
    const aliases=excelAliases[key];
    select.value=sheet.headers.findIndex(value=>aliases.includes(String(value).toLowerCase().replace(/[\s()（）_]/g,'')));
    select.onchange=()=>{excelState.result=null;$('excelGenerate').disabled=true;};
    label.append(select);return label;
  }));
  const head=el('tr');for(const value of ['Excel行号',...sheet.headers])head.append(el('th',value));
  $('excelHead').replaceChildren(head);
  $('excelRows').replaceChildren(...sheet.rows.map(row=>{
    const tr=el('tr');for(const value of [row.row,...row.cells])tr.append(el('td',value));return tr;
  }));
  await excelValidate();
}
async function excelUse(book){
  excelState.book=book;excelState.result=null;$('excelGenerate').disabled=true;
  $('excelFilename').textContent=book.name;
  $('excelSheet').replaceChildren(...book.sheets.map((sheet,index)=>new Option(sheet.name,index)));
  if(!$('excelDialog').open)$('excelDialog').showModal();
  await excelShowSheet();
}
$('excelOpen').onclick=async()=>{
  if(!$('excelDialog').open)$('excelDialog').showModal();
  if(!excelState.book)await excelRun(async()=>{const book=await api.excelLast();if(book)await excelUse(book);});
};
$('projectExcel').onclick=()=>{$('projectDialog').close();$('excelOpen').click();};
$('excelClose').onclick=()=>$('excelDialog').close();
$('excelChoose').onclick=()=>$('excelFile').click();
$('excelFile').onchange=()=>excelRun(async()=>{
  const file=$('excelFile').files[0];if(!file)return;
  excelState.result=null;$('excelGenerate').disabled=true;
  if(file.size>16*1024*1024)throw Error('Excel文件最大16 MiB。');
  statusLine('excelStatus','正在后台读取Excel…');
  const book=await api.excelRead(new Uint8Array(await file.arrayBuffer()),file.name);
  await excelUse(book);$('excelFile').value='';
});
$('excelSheet').onchange=()=>excelRun(excelShowSheet);
$('excelValidate').onclick=()=>excelRun(excelValidate);
$('excelRestore').onclick=()=>excelRun(async()=>{
  const book=await api.excelLast();if(!book)throw Error('没有上次导入记录。');await excelUse(book);
});
$('excelSourceSave').onclick=()=>excelRun(async()=>{
  await excelValidate();if(excelState.result&&await api.excelSave(excelState.result.source))statusLine('excelStatus','原始记录与字段映射已保存。');
});
$('excelGenerate').onclick=()=>excelRun(async()=>{
  await excelValidate();const graph=excelState.result?.graph;
  if(!graph||!guard())return;
  await run(async()=>{await display(graph,{fresh:true,view:'logic',timeline:false,workTable:false,fitView:true});changeDirty(true);});
  $('excelDialog').close();
});
