'use strict';

const projectTypes={wind:'风机',substation:'升压站',collector:'集电线路',road:'道路'};
const projectPrefixes={wind:'WT',substation:'SS',collector:'CL',road:'RD'};
const intake={templates:null,groups:[],type:'wind',busy:false};

async function projectAction(action){
  if(intake.busy)return;
  intake.busy=true;
  for(const id of ['projectRead','projectImport','projectSave','templatePreview','projectGenerate'])$(id).disabled=true;
  try{await action();}
  catch(error){statusLine('projectStatus',error.message,true);}
  finally{
    intake.busy=false;
    for(const id of ['projectRead','projectImport','projectSave','templatePreview','projectGenerate'])$(id).disabled=false;
  }
}

function renderGroups(groups){
  intake.groups=groups.map(group=>({...group}));
  for(const type of Object.keys(projectTypes))if(!intake.groups.some(group=>group.type===type)){
    intake.groups.push({type,count:0,prefix:projectPrefixes[type]});
  }
  const rows=intake.groups.map(group=>{
    const row=el('tr');
    const type=row.insertCell();type.append(el('span',projectTypes[group.type]));
    if(group.type==='collector'){
      const label=el('label','总体模块','aggregate-label'),toggle=el('input');
      toggle.type='checkbox';toggle.name='aggregate';toggle.checked=group.aggregate===true;
      label.prepend(toggle);type.append(label);
    }
    for(const [name,value,kind] of [['count',group.count,'number'],['prefix',group.prefix??projectPrefixes[group.type],'text'],['lengthKm',group.lengthKm??'','number']]){
      const input=el('input');
      input.name=name;input.type=kind;input.value=value;
      input.setAttribute('aria-label',projectTypes[group.type]+' '+name);
      if(kind==='number'){input.min='0';input.step=name==='count'?'1':'0.01';}
      row.insertCell().append(input);
    }
    return row;
  });
  $('projectUnits').replaceChildren(...rows);
}

function renderSteps(){
  const template=intake.templates?.[intake.type];
  if(!template)return;
  $('templateSteps').replaceChildren(...template.steps.map(step=>{
    const row=el('tr');row.insertCell().textContent=step.id;
    for(const [name,value] of [['label',step.label],['duration',step.duration],['after',step.after.join(',')]]){
      const input=el('input');input.value=value;input.name=name;
      input.setAttribute('aria-label',step.id+' '+name);
      if(name==='duration'){
        input.type='number';input.min='0';input.max='100000';input.step='1';
        input.required=true;
        input.oninput=()=>{step.estimated=false;};
        input.title=step.estimated?'模板占位工期，待估算':'已录入估算工期';
      }
      row.insertCell().append(input);
    }
    return row;
  }));
}

function captureSteps(){
  if(!intake.templates)return;
  const rows=Array.from($('templateSteps').rows);
  intake.templates[intake.type].steps=intake.templates[intake.type].steps.map((step,index)=>({
    ...step,label:rows[index].querySelector('[name=label]').value.trim(),
    duration:rows[index].querySelector('[name=duration]').value===''?null:Number(rows[index].querySelector('[name=duration]').value),
    after:rows[index].querySelector('[name=after]').value.split(/[,，\s]+/).filter(Boolean)
  }));
}

function readProject(){
  for(const input of $('projectDialog').querySelectorAll('input,select,textarea')){
    if(!input.reportValidity())throw Error('请填写有效的工程数量和工期。');
  }
  captureSteps();
  const rows=Array.from($('projectUnits').rows);
  const units=intake.groups.map((group,index)=>{
    const row=rows[index],rawLength=row.querySelector('[name=lengthKm]').value;
    return {...group,count:Number(row.querySelector('[name=count]').value),prefix:row.querySelector('[name=prefix]').value,
      lengthKm:rawLength===''?null:Number(rawLength),aggregate:row.querySelector('[name=aggregate]')?.checked??false};
  }).filter(group=>group.count!==0);
  return {version:1,kind:'project-brief',name:$('projectName').value,description:$('projectText').value,
    units,templates:intake.templates,foundation:$('projectFoundation').value,lineMethod:$('projectLine').value};
}

async function populateProject(brief){
  $('projectName').value=brief.name??'新建风电项目';
  $('projectText').value=brief.description??'';
  $('projectFoundation').value=brief.foundation??'unknown';
  $('projectLine').value=brief.lineMethod??'unknown';
  intake.templates=brief.templates?structuredClone(brief.templates):await api.projectTemplates({
    foundation:$('projectFoundation').value,lineMethod:$('projectLine').value});
  renderGroups(brief.units??[]);
  intake.type=$('projectType').value;
  renderSteps();
  statusLine('projectStatus',brief.notes?.join(' ')||'确认数量和模板后生成。默认工期均待估算。');
}

async function openProject(){
  if(!$('projectDialog').open)$('projectDialog').showModal();
  await projectAction(()=>populateProject(ui.graph?.project??{units:[]}));
}
$('projectOpen').onclick=openProject;
$('projectClose').onclick=()=>$('projectDialog').close();
$('projectRead').onclick=()=>projectAction(async()=>{
  const raw=$('projectText').value;
  await populateProject(await api.projectParse(raw,'auto'));
});
$('projectImport').onclick=()=>projectAction(async()=>{
  const project=await api.projectImport();
  if(project)await populateProject(project);
});
$('projectType').onchange=()=>{
  captureSteps();intake.type=$('projectType').value;renderSteps();
};
for(const id of ['projectFoundation','projectLine'])$(id).onchange=()=>projectAction(async()=>{
  captureSteps();
  const defaults=await api.projectTemplates({foundation:$('projectFoundation').value,lineMethod:$('projectLine').value});
  const type=id==='projectFoundation'?'wind':'collector';
  intake.templates[type]=defaults[type];renderSteps();
});
$('projectSave').onclick=()=>projectAction(async()=>{
  if(await api.projectSave(readProject()))statusLine('projectStatus','项目信息和模块模板已保存，可导入复用。');
});
$('templatePreview').onclick=()=>projectAction(async()=>{
  const brief=readProject(),type=intake.type;
  const result=await api.projectGenerate({...brief,name:'模块模板',units:[{type,count:1,prefix:projectPrefixes[type]}]});
  const unit=result.units[0].id;
  const drawing=await api.draw(result.graph,{networkView:'logic',unit});
  const svg=new DOMParser().parseFromString(drawing.svg,'image/svg+xml');
  if(svg.documentElement.localName!=='svg')throw Error('模块预览失败。');
  $('draftCanvas').replaceChildren(document.importNode(svg.documentElement,true));
  $('draftDialog').showModal();
});
$('projectGenerate').onclick=()=>projectAction(async()=>{
  const brief=readProject();
  const result=await api.projectGenerate(brief);
  if(!guard())return;
  await display(result.graph,{fresh:true,view:'logic',critical:false,timeline:false,workTable:false});
  changeDirty(true);
  statusLine('projectStatus','已生成 '+result.units.length+' 个单位工程模块。');
  $('projectDialog').close();
});

function refreshProjectNotice(){
  if(!ui.graph)return;
  const units=[...new Set(ui.graph.nodes.map(node=>node.unit).filter(Boolean))];
  const scope=$('unitScope');
  scope.hidden=!units.length;
  scope.replaceChildren(new Option('全项目网络',''),...units.map(id=>new Option(id+' 单位工程',id)));
  scope.value=ui.unit??'';
  const estimated=ui.graph.nodes.filter(node=>node.estimated&&(!ui.unit||node.unit===ui.unit)).length;
  const notice=$('projectNotice');
  notice.hidden=!ui.graph.project&&!ui.unit;
  if(!notice.hidden){
    const project=ui.graph.project;
    const warnings=[];
    if(project?.foundation==='unknown')warnings.push('基础型式待确认');
    if(project?.lineMethod==='unknown')warnings.push('线路型式待确认');
    if(project?.units.some(unit=>unit.aggregate))warnings.push('总体模块划分待确认');
    notice.textContent=(ui.unit?'单位工程内部网络，跨模块关系见全项目。':'模板初稿，按并行施工及全场受电汇合生成。')+
      ' '+estimated+' 道工期为占位值。'+warnings.join('，');
  }
}
$('unitScope').onchange=()=>run(async()=>{
  ui.selected=null;
  await display(ui.graph,{unit:$('unitScope').value||null,fitView:true});
  if(ui.unit){ui.zoom=1;frameZoom();}
});
document.addEventListener('griddraft:context-changed',refreshProjectNotice);
document.addEventListener('griddraft:plan-opened',()=>{
  if(!ui.graph.nodes.length)openProject();
});
if(ui.graph&&!ui.graph.nodes.length)openProject();
