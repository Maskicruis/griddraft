'use strict';
const $=id=>document.getElementById(id);
const ui={graph:null,file:null,previous:[],next:[],selected:null,list:'node',link:null,critical:false,
  timeline:false,analysis:null,network:null,summary:null,view:'time',workTable:false,zoom:1,busy:false,dirty:false,pointer:null,unit:null,drill:null,motion:true,viewport:null};
try{ui.motion=localStorage.getItem('griddraft-motion')!=='off';}catch{}
const names={task:'工序',decision:'判断',milestone:'里程碑'};
const api=window.grid;
const blank=()=>({version:1,title:'未命名网络图',direction:'RIGHT',nodes:[],edges:[]});
function el(tag,description,css){
  const value=document.createElement(tag);
  if(description!=null)value.textContent=description;
  if(css)value.className=css;
  return value;
}
function button(text,action,css){const b=el('button',text,css);b.type='button';b.onclick=action;return b;}
function say(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
async function run(action){
  if(ui.busy)return;
  ui.busy=true;
  $('canvas').setAttribute('aria-busy','true');
  try{await action();}
  catch(error){say(error.message,true);}
  finally{ui.busy=false;$('canvas').setAttribute('aria-busy','false');}
}
function changeDirty(dirty){
  ui.dirty=dirty;
  $('dirty').textContent=dirty?'有未保存更改':ui.file?'已保存':'本地画布';
  api.dirty(dirty).catch(error=>say(error.message,true));
}
function frameZoom(){
  const svg=$('stage').firstElementChild;
  if(!svg)return;
  const vb=svg.viewBox.baseVal;
  const width=vb.width*ui.zoom,height=vb.height*ui.zoom;
  svg.style.width=width+'px';svg.style.height=height+'px';
  $('stage').style.width=Math.ceil(width)+'px';$('stage').style.height=Math.ceil(height)+'px';
  $('zoom').textContent=Math.round(ui.zoom*100)+'%';
}
function fit({readable=false}={}){
  const svg=$('stage').firstElementChild;
  if(!svg||ui.timeline||ui.workTable)return;
  const {width,height}=svg.viewBox.baseVal,view=$('canvas');
  ui.zoom=Math.max(.05,Math.min(1.25,(view.clientWidth-28)/width,(view.clientHeight-36)/height));
  if(readable&&ui.view==='time')ui.zoom=Math.max(.78,ui.zoom);
  frameZoom();
  view.scrollTo(0,0);
}
function dataForSelection(){
  if(!ui.selected)return null;
  const {kind,id}=ui.selected;
  const items=kind==='event'?ui.network?.events:kind==='node'?ui.graph.nodes:ui.graph.edges;
  return items?.find(item=>item.id===id) || null;
}
function select(kind,id){
  ui.selected=id?{kind,id}:null;
  if(id&&kind!=='event'&&ui.list!==kind){ui.list=kind;$('find').value='';}
  paintSelection();
  renderList();
  inspector();
  document.dispatchEvent(new Event('griddraft:context-changed'));
}
function paintSelection(){
  $('stage').querySelectorAll('[data-node],[data-edge]').forEach(n=>{
    n.classList.toggle('selected',n.dataset.node===ui.selected?.id&&ui.selected?.kind==='node'||
      n.dataset.edge===ui.selected?.id&&ui.selected?.kind==='edge');
  });
  $('stage').querySelectorAll('[data-activity],[data-event]').forEach(n=>{
    n.classList.toggle('selected',n.dataset.activity===ui.selected?.id&&ui.selected?.kind==='node'||
      Number(n.dataset.event)===ui.selected?.id&&ui.selected?.kind==='event');
  });
  $('timeline').querySelectorAll('.time-row[data-id]').forEach(row=>row.classList.toggle('selected',ui.selected?.kind==='node'&&row.dataset.id===ui.selected.id));
}
function refresh(){
  $('title').textContent=ui.graph.title;
  $('direction').value=ui.graph.direction;
  $('undo').disabled=!ui.previous.length;$('redo').disabled=!ui.next.length;
  $('cpm').setAttribute('aria-pressed',String(ui.critical));
  $('link').setAttribute('aria-pressed',String(ui.link!==null));
  $('timelineView').setAttribute('aria-pressed',String(ui.timeline));
  $('workList').setAttribute('aria-pressed',String(ui.workTable));
  for(const [id,view] of [['networkTime','time'],['networkLogic','logic'],['flowView','flow']])
    $(id).setAttribute('aria-pressed',String(ui.view===view&&!ui.timeline&&!ui.workTable));
  $('summaryView').hidden=!ui.graph.nodes.some(node=>node.unit);
  $('summaryView').setAttribute('aria-pressed',String(ui.view==='summary'));
  $('summaryBack').hidden=!ui.unit;
  $('networkAuto').hidden=ui.view!=='time'||ui.timeline||ui.workTable;
  $('flowMotion').hidden=!(ui.network||ui.summary)||ui.timeline||ui.workTable;
  $('flowMotion').setAttribute('aria-pressed',String(ui.motion));
  $('stage').classList.toggle('motion-paused',!ui.motion);
  for(const id of ['add','link','timelineView','workList','edgeList'])$(id).disabled=Boolean(ui.summary);
  $('canvas').hidden=ui.timeline||ui.workTable;$('timeline').hidden=!ui.timeline;$('workTable').hidden=!ui.workTable;
  for(const id of ['minus','plus','fit','zoom'])$(id).hidden=ui.timeline||ui.workTable;
  $('exportNetworkData').hidden=!ui.network;
  for(const id of ['direction','layout','cpm'])$(id).hidden=ui.view!=='flow'||ui.timeline||ui.workTable;
  if(!dataForSelection())ui.selected=null;
  if(ui.timeline)drawTimeline();
  if(ui.workTable)drawWorkTable();
  renderList();inspector();paintSelection();
}
async function display(graph,{fresh=false,change=false,forceLayout=false,fitView=false,critical=ui.critical,timeline=ui.timeline,view=ui.view,workTable=ui.workTable,unit=fresh?null:ui.unit}={}){
  if(unit&&!graph.nodes.some(node=>node.unit===unit))unit=null;
  let result, analysisError;
  const viewport={width:$('canvas').clientWidth||1000,height:$('canvas').clientHeight||650};
  try{result=await api.draw(graph,{critical:critical||timeline,forceLayout,networkView:!timeline&&view!=='flow'?view:null,unit,viewport,animated:true});}
  catch(error){
    if(!['CYCLE','MISSING_DURATION','EMPTY_NETWORK'].includes(error.code))throw error;
    analysisError=error.message;
    critical=false;timeline=false;view='flow';workTable=false;
    result=await api.draw(graph,{forceLayout,unit});
  }
  if(fresh){ui.previous=[];ui.next=[];ui.selected=null;ui.file=null;ui.link=null;changeDirty(false);}
  if(change){
    ui.previous.push(ui.graph);
    if(ui.previous.length>120)ui.previous.shift();
    ui.next=[];
    changeDirty(true);
  }
  ui.graph=result.graph;ui.analysis=result.analysis;ui.critical=critical;ui.timeline=timeline;ui.view=result.summary?'summary':view==='auto'?'logic':view;ui.unit=unit;
  ui.summary=result.summary||null;
  ui.viewport=viewport;
  if(fresh)ui.drill=null;
  if(fresh)document.dispatchEvent(new Event('griddraft:plan-opened'));
  ui.network=result.network||null;
  ui.workTable=workTable&&Boolean(ui.network);
  const parsed=new DOMParser().parseFromString(result.svg,'image/svg+xml');
  if(parsed.documentElement.localName!=='svg')throw Error('绘图引擎返回了无效的 SVG。');
  $('stage').replaceChildren(document.importNode(parsed.documentElement,true));
  refresh();
  if(fresh||fitView)fit({readable:true});else frameZoom();
  const count=ui.summary?ui.summary.sourceNodeCount+' 个源节点 → '+ui.summary.nodes.length+' 个汇总节点 · 点击模块进入详细网络':ui.network?ui.network.events.length+' 个事件 · '+ui.network.arrows.filter(a=>a.kind==='activity').length+
    ' 道工作 · '+ui.network.arrows.filter(a=>a.kind==='dummy').length+' 条虚工作':ui.graph.nodes.length+' 个节点 · '+ui.graph.edges.length+' 条连线';
  say(analysisError || count+(ui.analysis?' · 逻辑工期 '+ui.analysis.duration+' 天':''),Boolean(analysisError));
  document.dispatchEvent(new Event('griddraft:context-changed'));
}
async function edit(operations){await display(await api.edit(ui.graph,operations),{change:true});}
function renderList(){
  if(!ui.graph)return;
  $('nodeList').setAttribute('aria-pressed',String(ui.list==='node'));
  $('edgeList').setAttribute('aria-pressed',String(ui.list==='edge'));
  const find=$('find').value.trim().toLowerCase();
  if(ui.summary){
    const modules=ui.summary.nodes.filter(node=>node.kind==='module'&&[node.label,...node.units].some(value=>value.toLowerCase().includes(find)));
    $('objects').replaceChildren(...modules.map(node=>{
      const b=button(node.label,()=>run(()=>enterModule(node.id)),'object');
      b.append(el('small',node.units[0]+(node.units.length>1?' … '+node.units.at(-1):'')+' · '+node.stepCount+' 道工序/个'));
      return b;
    }));
    return;
  }
  const visible=new Set(ui.graph.nodes.filter(node=>!ui.unit||node.unit===ui.unit).map(node=>node.id));
  const items=(ui.list==='node'?ui.graph.nodes.filter(node=>visible.has(node.id)):
    ui.graph.edges.filter(edge=>visible.has(edge.from)&&visible.has(edge.to))).filter(n=>[n.id,n.label,n.from,n.to].some(v=>v?.toLowerCase().includes(find)));
  const scroll=$('objects').scrollTop;
  $('objects').replaceChildren(...items.map(item=>{
    const kind=ui.list;
    const b=button(item.label||(item.from+' → '+item.to),()=>select(kind,item.id),'object'+
      (ui.selected?.id===item.id&&ui.selected.kind===kind?' active':''));
    b.dataset.id=item.id;
    b.append(el('small',item.id+(kind==='node'?' · '+names[item.kind]:'')));
    return b;
  }));
  $('objects').scrollTop=scroll;
}
function field(form,key,label,value,type='text',choices){
  const wrapper=el('label',label),input=el(choices?'select':'input');
  input.name=key;
  if(choices)for(const [code,display] of choices)input.add(new Option(display,code));
  else input.type=type;
  input.value=value??'';
  wrapper.append(input);form.append(wrapper);return input;
}
function inspector(){
  if(!ui.graph)return;
  const selected=dataForSelection(),area=$('properties');
  if(ui.summary){
    area.replaceChildren(el('h2','重复模块汇总'),el('p','结构、名称、工期、内部依赖及外部衔接相同的单位工程合并展示。点击模块进入代表工程，通过单位工程选择器切换其他实例。','aside-note'),
      el('p','仅折叠显示，完整工序和关系均保存在源文件中。对外控制点按分段保留；工期和关键线路按源网络计算。','aside-note'));
    return;
  }
  const form=el('form');
  if(!selected){
    const title=field(form,'title','图名称',ui.graph.title);
    title.required=true;title.maxLength=120;
    const save=el('button','修改名称','primary');form.append(save);
    form.onsubmit=event=>{event.preventDefault();run(()=>edit([{op:'set-title',value:title.value}]));};
    area.replaceChildren(form,el('p','点击节点或连线查看属性。拖动空白处平移画布。双击空白处可新增节点。','aside-note'));
    return;
  }
  const kind=ui.selected.kind;
  if(kind==='event'){
    area.replaceChildren(el('h2','事件 '+selected.id),el('p','最早发生 D'+selected.early+' · 最迟发生 D'+selected.late,'aside-note'));
    for(const milestone of selected.milestones)area.append(el('p',milestone.label,'aside-note'));
    return;
  }
  field(form,'id','编号',selected.id).readOnly=true;
  const label=field(form,'label',kind==='node'?'节点名称':'连线说明',selected.label);
  label.maxLength=kind==='node'?96:80;label.required=kind==='node';
  if(kind==='node'){
    const kindInput=field(form,'kind','类型',selected.kind,'text',Object.entries(names));
    const duration=field(form,'duration','工期（天）',selected.duration,'number');
    duration.min=0;duration.max=100000;
    if(selected.estimated)form.append(el('p','当前工期为模板占位值，请按本项目条件估算。','aside-note'));
    if(selected.unit||selected.estimated!==undefined)field(form,'estimated','工期来源',String(selected.estimated??false),'text',
      [['false','已录入本项目工期'],['true','模板占位，待估算']]);
    kindInput.onchange=()=>{
      if(kindInput.value==='milestone')duration.value='0';
    };
    const analysis=ui.analysis?.nodes.find(row=>row.id===selected.id);
    const work=ui.network?.arrows.find(row=>row.activityId===selected.id);
    if(work)form.append(el('p','双代号 '+work.from+'–'+work.to+(work.critical?' · 关键工作':''),'aside-note'));
    if(analysis)form.append(el('p','最早 D'+analysis.es+' → D'+analysis.ef+' · 总时差 '+analysis.tf+' · 自由时差 '+analysis.ff+' 天','aside-note'));
  }else{
    const choices=ui.graph.nodes.map(n=>[n.id,n.id+' · '+n.label]);
    field(form,'from','起点',selected.from,'text',choices);
    field(form,'to','终点',selected.to,'text',choices);
    const lag=field(form,'lag','完成到开始时滞（天）',selected.lag,'number');
    lag.min=0;lag.max=100000;lag.required=true;
  }
  const actions=el('div',null,'actions');
  actions.append(el('button','应用修改','primary'),button('删除',()=>{
    if(confirm('删除此'+(kind==='node'?'节点及关联连线':'连线')+'？'))run(()=>edit([{op:'remove-'+kind,id:selected.id}]));
  }));
  form.append(actions);
  form.onsubmit=event=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(form));
    if(kind==='node'){
      const duration=values.duration===''?undefined:Number(values.duration);
      run(()=>edit([{op:'put-node',node:{...selected,label:values.label,kind:values.kind,duration,
        ...(values.estimated===undefined?{}:{estimated:values.estimated==='true'})}}]));
    }else run(()=>edit([{op:'put-edge',edge:{...selected,label:values.label,from:values.from,to:values.to,lag:Number(values.lag)}}]));
  };
  area.replaceChildren(form);
}
function drawWorkTable(){
  const region=$('workTable');
  if(!ui.network){region.replaceChildren();return;}
  const table=el('table',null,'work-grid');
  const header=table.createTHead().insertRow();
  for (const text of ['工作代号','工作名称','类型','持续时间','ES','EF','TF','FF']) header.append(el('th',text));
  const body=table.createTBody();
  for(const arc of ui.network.arrows.slice().sort((a,b)=>a.from-b.from||a.to-b.to)){
    const row=body.insertRow();
    if(arc.critical)row.className='critical-work';
    row.insertCell().textContent=arc.from+'–'+arc.to;
    const name=row.insertCell();
    if(arc.activityId)name.append(button(arc.label,()=>select('node',arc.activityId)));
    else name.textContent=arc.label;
    for(const value of [{activity:'工作',lag:'时滞',dummy:'虚工作'}[arc.kind],arc.duration,arc.earlyStart,arc.earlyFinish,arc.totalFloat,arc.freeFloat])
      row.insertCell().textContent=value;
  }
  region.replaceChildren(table);
}
function drawTimeline(){
  const area=$('timeline'),analysis=ui.analysis;
  const scrolled=area.scrollTop;
  if(!analysis){area.replaceChildren(el('p','请录入工期后重新计算。','aside-note'));return;}
  const board=el('div',null,'time-grid'),head=el('div',null,'time-row time-head');
  const axis=el('div',null,'time-axis time-track');
  for(let i=0;i<=5;i++)axis.append(el('span','D'+Math.round(analysis.duration*i/5)));
  head.append(el('span','工序 / 逻辑开完工'),axis);board.append(head);
  const nodes=new Map(ui.graph.nodes.map(n=>[n.id,n]));
  const total=Math.max(1,analysis.duration);
  for(const row of analysis.nodes){
    const task=nodes.get(row.id);
    const line=el('div',null,'time-row');line.dataset.id=row.id;
    const name=button(task.label,()=>select('node',task.id));
    name.title=row.id+' · D'+row.es+' → D'+row.ef;
    const track=el('div',null,'time-track');
    const bar=el('span',null,'time-bar'+(row.tf===0?' hot':'')+(task.kind==='milestone'?' marker':''));
    bar.style.left=100*row.es/total+'%';bar.style.width=100*(row.ef-row.es)/total+'%';bar.title=name.title;
    track.append(bar);
    line.append(name,track);board.append(line);
  }
  area.replaceChildren(board);area.scrollTop=scrolled;
}
function coordinates(event){
  const svg=$('stage').firstElementChild;
  const p=new DOMPoint(event.clientX,event.clientY);
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
function newNode(location){
  if(ui.busy||!ui.graph)return;
  const form=$('nodeForm');form.reset();form.querySelector('.form-error').textContent='';
  if(ui.network)form.elements.duration.value='1';
  form.elements.kind.onchange=()=>{
    if(form.elements.kind.value==='milestone')form.elements.duration.value='0';
  };
  form.elements.id.value='N'+String(ui.graph.nodes.length+1+(ui.graph.nodes.find(n=>n.id==='N'+String(ui.graph.nodes.length+1))?Date.now()%100000:0));
  const position=location?{x:Math.round(location.x-85),y:Math.round(location.y-29)}:
    {x:32+(ui.graph.nodes.length%5)*195,y:28+Math.floor(ui.graph.nodes.length/5)*82};
  form.onsubmit=async event=>{
    event.preventDefault();
    if(ui.busy)return;
    const data=Object.fromEntries(new FormData(form));
    if(ui.graph.nodes.some(n=>n.id===data.id)){form.querySelector('.form-error').textContent='节点编号已存在。';return;}
    await run(async()=>{
      try{
        const unit=ui.unit?ui.graph.nodes.find(node=>node.unit===ui.unit):null;
        await edit([{op:'put-node',node:{...data,position,duration:data.duration===''?undefined:Number(data.duration),
          ...(unit?{unit:unit.unit,unitType:unit.unitType,estimated:false}:{})}}]);
        $('nodeDialog').close();select('node',data.id);
      }catch(error){form.querySelector('.form-error').textContent=error.message;}
    });
  };
  $('nodeDialog').showModal();
}
function pickConnection(id){
  if(!ui.link.from){ui.link.from=id;select('node',id);say('选择连线终点 · '+id);return;}
  const from=ui.link.from;
  ui.link=null;
  const edge={id:'E-'+crypto.randomUUID(),from,to:id,label:'',lag:0};
  run(async()=>{await edit([{op:'put-edge',edge}]);select('edge',edge.id);});
}
const canvas=$('canvas');
async function enterModule(id){
  const module=ui.summary?.nodes.find(node=>node.id===id);
  if(!module?.units.length)return;
  ui.drill={units:module.units.slice(),stage:module.stage,stageCount:module.stageCount};
  ui.selected=null;
  await display(ui.graph,{unit:module.units[0],view:'logic',timeline:false,workTable:false,fitView:true});
  ui.zoom=1;frameZoom();
  const first=module.sourceIds.find(id=>ui.graph.nodes.find(node=>node.id===id)?.unit===ui.unit);
  if(first){select('node',first);$('stage').querySelector('[data-activity="'+CSS.escape(first)+'"]')?.scrollIntoView({block:'center',inline:'center'});}
}
canvas.onpointerdown=event=>{
  if(ui.busy||!ui.graph||event.button!==0)return;
  const activity=event.target.closest('[data-activity]'),marker=event.target.closest('[data-event]');
  if(marker){select('event',Number(marker.dataset.event));return;}
  if(activity?.dataset.activity){
    if(ui.link)pickConnection(activity.dataset.activity);
    else select('node',activity.dataset.activity);
    return;
  }
  const module=event.target.closest('[data-module]');
  const node=event.target.closest('[data-node]'),edge=event.target.closest('[data-edge]');
  if(node&&ui.link){pickConnection(node.dataset.node);return;}
  if(edge){select('edge',edge.dataset.edge);return;}
  const task=node?ui.graph.nodes.find(n=>n.id===node.dataset.node):null;
  if(task)select('node',task.id);
  const start=coordinates(event);
  ui.pointer={id:event.pointerId,node,task,module:module?.dataset.module,start,clientX:event.clientX,clientY:event.clientY,
    scrollLeft:canvas.scrollLeft,scrollTop:canvas.scrollTop,moved:false};
  canvas.setPointerCapture(event.pointerId);
};
canvas.onpointermove=event=>{
  const d=ui.pointer;
  if(!d||d.id!==event.pointerId)return;
  if(Math.hypot(event.clientX-d.clientX,event.clientY-d.clientY)>3)d.moved=true;
  if(!d.moved)return;
  canvas.classList.add('dragging');
  if(!d.task){
    canvas.scrollLeft=d.scrollLeft+d.clientX-event.clientX;canvas.scrollTop=d.scrollTop+d.clientY-event.clientY;return;
  }
  const p=coordinates(event);
  d.position={x:Math.round(d.task.position.x+p.x-d.start.x),y:Math.round(d.task.position.y+p.y-d.start.y)};
  d.node.setAttribute('transform','translate('+d.position.x+' '+d.position.y+')');
};
function endPointer(event){
  const d=ui.pointer;
  if(!d||event.pointerId!==d.id)return;
  ui.pointer=null;canvas.classList.remove('dragging');
  if(d.module&&!d.moved&&event.type==='pointerup'){run(()=>enterModule(d.module));return;}
  if(!d.task&&!d.moved)select(null,null);
  if(d.node)d.node.setAttribute('transform','translate('+d.task.position.x+' '+d.task.position.y+')');
  if(d.task&&d.position&&event.type==='pointerup')run(()=>edit([{op:'put-node',node:{...d.task,position:d.position}}]));
}
canvas.onpointerup=endPointer;canvas.onpointercancel=endPointer;
canvas.ondblclick=event=>{if(!ui.summary&&!event.target.closest('[data-node],[data-edge],[data-event],[data-activity]')&&ui.graph)newNode(coordinates(event));};
canvas.addEventListener('keydown',event=>{
  const module=event.target.closest('[data-module]');
  if(module&&['Enter',' '].includes(event.key)){event.preventDefault();run(()=>enterModule(module.dataset.module));}
});
$('summaryView').onclick=$('summaryBack').onclick=()=>run(()=>display(ui.graph,{unit:null,view:'summary',timeline:false,workTable:false,fitView:true}));
$('find').oninput=renderList;
for(const kind of ['node','edge'])$(kind+'List').onclick=()=>{ui.list=kind;renderList();};
$('add').onclick=()=>newNode();$('cancelAdd').onclick=()=>$('nodeDialog').close();
$('link').onclick=()=>{
  ui.link=ui.link?null:{from:ui.selected?.kind==='node'?ui.selected.id:null};
  $('link').setAttribute('aria-pressed',String(ui.link!==null));
  say(ui.link?(ui.link.from?'选择连线终点 · '+ui.link.from:'选择连线起点'):'已取消连线。');
};
const guard=()=>!ui.dirty||confirm('当前网络图尚未保存，继续将放弃本次更改。');
$('new').onclick=()=>run(async()=>{if(guard())await display(blank(),{fresh:true,critical:false,timeline:false,view:'flow',workTable:false});});
$('demo').onclick=()=>run(async()=>{if(guard())await display(await api.demo(),{fresh:true,critical:false,timeline:false,view:'time',workTable:false});});
async function openGraph(){
  if(!guard())return;
  const opened=await api.open();
  if(opened){await display(opened.graph,{fresh:true,critical:false,timeline:false,view:'auto',workTable:false});ui.file=opened.file;changeDirty(false);}
}
$('open').onclick=()=>run(openGraph);
async function save(as){
  if(!ui.graph)return;
  const file=await api.save(ui.graph,as?null:ui.file);
  if(file){ui.file=file;changeDirty(false);say('图文件已保存。');}
}
$('save').onclick=()=>run(()=>save(false));$('saveAs').onclick=()=>run(()=>save(true));
$('export').onclick=()=>run(async()=>{if(ui.graph&&await api.svg(ui.graph,ui.view==='flow'?ui.critical:ui.view,ui.unit))say('SVG 已导出。');});
$('exportNetworkData').onclick=()=>run(async()=>{if(await api.networkData(ui.graph,ui.unit))say('双代号事件 JSON 已导出。');});
for(const [id,view] of [['networkTime','time'],['networkLogic','logic'],['flowView','flow']])
  $(id).onclick=()=>run(()=>display(ui.graph,{view,fitView:true,timeline:false,workTable:false}));
$('workList').onclick=()=>run(()=>display(ui.graph,{view:ui.view==='flow'?'time':ui.view,timeline:false,workTable:!ui.workTable,fitView:true}));
$('layout').onclick=()=>run(()=>display({...ui.graph,direction:$('direction').value},{forceLayout:true,fitView:true,change:true}));
$('cpm').onclick=()=>run(()=>display(ui.graph,{critical:!ui.critical,timeline:false}));
$('timelineView').onclick=()=>run(()=>display(ui.graph,{timeline:!ui.timeline,workTable:false,fitView:true}));
$('fit').onclick=()=>fit();
$('actualSize').onclick=()=>{ui.zoom=1;frameZoom();};
$('networkAuto').onclick=()=>run(()=>display(ui.graph,{view:'time',fitView:true,timeline:false,workTable:false}));
$('flowMotion').onclick=()=>{
  ui.motion=!ui.motion;$('stage').classList.toggle('motion-paused',!ui.motion);
  $('flowMotion').setAttribute('aria-pressed',String(ui.motion));
  try{localStorage.setItem('griddraft-motion',ui.motion?'on':'off');}catch{}
};
let resizeTimer;
new ResizeObserver(()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    if(ui.busy||ui.view!=='time'||ui.timeline||ui.workTable||!ui.graph||!ui.viewport)return;
    const canvas=$('canvas');
    if(Math.abs(canvas.clientWidth-ui.viewport.width)<60&&Math.abs(canvas.clientHeight-ui.viewport.height)<60)return;
    run(()=>display(ui.graph,{fitView:true}));
  },450);
}).observe($('canvas'));
for(const [id,gain] of [['plus',1.22],['minus',1/1.22]])$(id).onclick=()=>{ui.zoom=Math.min(4,Math.max(.05,ui.zoom*gain));frameZoom();};
async function restoreHistory(from,to){
    if(!from.length)return;
    const previous=ui.graph;
    await display(from.at(-1));
    from.pop();to.push(previous);
    changeDirty(true);refresh();
}
function history(from,to){
  return run(()=>restoreHistory(from,to));
}
$('undo').onclick=()=>history(ui.previous,ui.next);$('redo').onclick=()=>history(ui.next,ui.previous);
document.addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey))return;
  const k=e.key.toLowerCase();
  if(k==='s'){e.preventDefault();$('save').click();}
  if(k==='z'&&!e.target.matches('input,textarea,select')){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}
});
run(async()=>display(blank(),{fresh:true,view:'flow'}));
