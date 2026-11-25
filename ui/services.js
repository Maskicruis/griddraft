'use strict';

const form = $('modelForm');
const modelFields = form.elements;
const modelOptions = {
  deepseek:{endpoint:'https://api.deepseek.com/anthropic',model:'deepseek-flash'},
  compatible:{endpoint:'https://api.siliconflow.cn/v1',model:''}
};
let modelBusy = false, updatesBusy = false, settingsRequest = 0;

function statusLine(id, message, error=false) {
  $(id).textContent = message;
  $(id).classList.toggle('error',error);
}

function settingsTab(tab) {
  for (const button of document.querySelectorAll('[data-settings]')) {
    button.setAttribute('aria-pressed',String(button.dataset.settings===tab));
  }
  for (const panel of document.querySelectorAll('[data-setting-panel]')) {
    panel.hidden=panel.dataset.settingPanel!==tab;
  }
}

function readModelForm() {
  const {provider,endpoint,model,key} = Object.fromEntries(new FormData(form));
  return {provider,endpoint,model,key,removeKey:modelFields.removeKey.checked};
}

function populateModel(saved) {
  for (const name of ['provider','endpoint','model']) modelFields[name].value=saved[name];
  modelFields.key.value='';
  modelFields.key.placeholder=saved.hasKey?'已保存，留空保留当前服务的密钥':'输入 API 密钥';
  modelFields.removeKey.checked=false;
  if(saved.version)$('settingsVersion').textContent='V'+saved.version;
}

async function modelAction(action) {
  if(modelBusy)return;
  modelBusy=true;
  $('modelSave').disabled=$('modelTest').disabled=true;
  try { await action(); }
  catch(error) { statusLine('modelStatus',error.message,true); }
  finally {
    modelBusy=false;
    $('modelSave').disabled=$('modelTest').disabled=false;
  }
}

function openSettings() {
  const dialog=$('settingsDialog');
  if(!dialog.open)dialog.showModal();
  settingsTab('model');
  const request=++settingsRequest;
  if(!modelBusy)modelAction(async()=>{
    statusLine('modelStatus','正在读取设置…');
    const saved=await api.modelSettings();
    if(request!==settingsRequest||!dialog.open)return;
    populateModel(saved);
    statusLine('modelStatus',saved.hasKey?'已保存 API 密钥':'尚未配置 API 密钥');
  });
}

$('settingsOpen').onclick=openSettings;
$('agentSettings').onclick=openSettings;
$('settingsClose').onclick=()=>$('settingsDialog').close();
$('settingsDialog').addEventListener('close',()=>{modelFields.key.value='';});
for(const button of document.querySelectorAll('[data-settings]'))button.onclick=()=>settingsTab(button.dataset.settings);
modelFields.provider.onchange=()=>{
  const selected=modelOptions[modelFields.provider.value];
  modelFields.endpoint.value=selected.endpoint;
  modelFields.model.value=selected.model;
  modelFields.key.value='';
  modelFields.key.placeholder='输入该服务商的 API 密钥';
  statusLine('modelStatus','更换服务商或 API 地址后，请填写对应的密钥。');
};
$('modelTest').onclick=()=>{
  if(!form.reportValidity())return;
  modelAction(async()=>{
    statusLine('modelStatus','正在通过 Harness 测试模型…');
    await api.modelTest(readModelForm());
    statusLine('modelStatus','连接成功，可以保存配置。');
  });
};
form.onsubmit=event=>{
  event.preventDefault();
  modelAction(async()=>{
    const saved=await api.modelSave(readModelForm());
    populateModel(saved);
    statusLine('modelStatus',saved.hasKey?'模型配置与密钥已保存。':'模型配置已保存，尚未设置密钥。');
  });
};

async function updateAction(action) {
  if(updatesBusy)return;
  updatesBusy=true;
  $('updateCheck').disabled=$('updateDownload').disabled=true;
  try { await action(); }
  catch(error) { statusLine('updateStatus',error.message,true); }
  finally {
    updatesBusy=false;
    $('updateCheck').disabled=$('updateDownload').disabled=false;
  }
}

$('showRelease').onclick=()=>api.releasePage().catch(error=>statusLine('updateStatus',error.message,true));
$('updateCheck').onclick=()=>updateAction(async()=>{
  statusLine('updateStatus','正在检查 GitHub 正式发布…');
  $('updateDownload').hidden=$('updateNotes').hidden=$('updateReveal').hidden=true;
  const update=await api.updateCheck();
  statusLine('updateStatus',update.available?'可用新版 V'+update.version:'当前 V'+update.current+' 已是最新版本');
  $('updateDownload').hidden=!update.available;
  $('updateNotes').hidden=!update.notes;
  $('updateNotes').textContent=update.notes;
});
$('updateDownload').onclick=()=>updateAction(async()=>{
  statusLine('updateStatus','选择保存位置…');
  const progress=$('updateProgress');
  progress.value=0;
  try{
    const completed=await api.updateDownload();
    statusLine('updateStatus',completed?'下载和 SHA‑256 校验完成。':'已取消下载。');
    $('updateReveal').hidden=!completed;
  }finally{progress.hidden=true;}
});
$('updateReveal').onclick=()=>api.updateReveal().catch(error=>statusLine('updateStatus',error.message,true));
api.updateProgress(percent=>{
  $('updateProgress').hidden=false;
  $('updateProgress').value=percent;
  statusLine('updateStatus','下载新版 · '+percent+'%');
});

const conversation = {running:false,output:null,draft:null,actions:[],planStamp:null,generation:0,activeGeneration:null,started:false};
const toolNames={inspect_schedule:'检查当前网络',list_tasks:'查找工序',list_links:'查找连线',
  simulate_durations:'试算工期变更',edit_network:'修改网络图草稿',replace_network:'创建完整网络图',
  undo_draft:'撤销草稿修改',discard_draft:'放弃草稿',interface_action:'准备界面操作'};

function appendMessage(text,role) {
  const message=el('p',text,'agent-message '+role);
  $('agentMessages').append(message);
  scrollMessages();
  return message;
}

function scrollMessages() {
  const messages=$('agentMessages');
  messages.scrollTop=messages.scrollHeight;
}

function showDraft(draft, stamp) {
  conversation.draft=draft;
  conversation.planStamp=stamp;
  $('agentDraft').hidden=!draft;
  if(!draft)return;
  $('draftTitle').textContent='网络图草稿 · '+draft.changes.length+' 项变更 · 工期 '+(draft.before??'待计算')+' → '+(draft.after??'待计算')+' 天';
  $('draftChanges').replaceChildren(...draft.changes.map(change=>el('li',change.description)));
  $('draftIssues').textContent=draft.issues.map(issue=>issue.message).join('；');
}

function resetConversation() {
  api.agentReset().catch(error=>appendMessage(error.message,'assistant'));
  conversation.actions=[];
  conversation.started=false;
  conversation.generation++;
  conversation.output=null;
  showDraft(null,null);
  $('agentMessages').replaceChildren();
  appendMessage('可以创建网络、增删工序和连线、连续修改草稿，也可切换视图、定位、保存和导出。','assistant');
}

function updateAgentContext(){
  if(!ui.graph)return;
  const names={time:'双代号时标',logic:'双代号结构',flow:'流程编辑'};
  const selected=dataForSelection();
  $('agentContext').textContent=ui.graph.title+' · '+(ui.timeline?'时间轴':ui.workTable?'工作表':names[ui.view])+
    (selected?' · 选中 '+(selected.label||selected.id):'');
}
document.addEventListener('griddraft:context-changed',updateAgentContext);
$('agentOpen').onclick=()=>{
  if(!ui.graph)return;
  updateAgentContext();
  if(!$('agentDialog').open)$('agentDialog').show();
  $('agentQuestion').focus();
};
$('agentClose').onclick=()=>$('agentDialog').close();
$('agentReset').onclick=resetConversation;
document.addEventListener('griddraft:plan-opened',()=>{
  if(conversation.running)api.agentStop().catch(()=>{});
  conversation.generation++;
  conversation.output=null;conversation.actions=[];
  showDraft(null,null);
  if(conversation.started)appendMessage('已切换当前网络图。后续操作以新打开的图为准。','tool');
  updateAgentContext();
});
resetConversation();

api.agentEvent(event=>{
  if(!conversation.running||conversation.activeGeneration!==conversation.generation)return;
  if(event.kind==='tool'){
    if(conversation.output&&!conversation.output.textContent)conversation.output.remove();
    appendMessage(toolNames[event.name]??'处理计划数据','tool');
    conversation.output=null;
  }else if(event.kind==='text'){
    if(!conversation.output)conversation.output=appendMessage('','assistant');
    conversation.output.textContent+=event.text;
    scrollMessages();
  }
});

$('agentStop').onclick=()=>api.agentStop().catch(error=>appendMessage(error.message,'assistant'));
$('agentForm').onsubmit=async event=>{
  event.preventDefault();
  const question=$('agentQuestion').value.trim();
  if(!question||!ui.graph||conversation.running)return;
  const generation=conversation.generation;
  const stamp=JSON.stringify(ui.graph);
  const plan=ui.graph;
  conversation.running=true;
  conversation.started=true;
  conversation.activeGeneration=generation;
  $('agentSend').disabled=$('agentReset').disabled=true;
  $('draftApply').disabled=$('draftPreview').disabled=true;
  $('agentStop').hidden=false;
  $('agentQuestion').value='';
  appendMessage(question,'user');
  const working=appendMessage('正在读取当前计划…','tool');
  conversation.output=appendMessage('','assistant');
  try{
    const selected=dataForSelection();
    const selection=ui.selected?{...ui.selected,details:selected}:null;
    if(selection?.kind==='event'){
      const arrows=ui.network.arrows.filter(arrow=>arrow.from===selection.id||arrow.to===selection.id);
      selection.relatedArrows=arrows.slice(0,100);
      selection.relatedCount=arrows.length;
    }
    const context={view:ui.timeline?'timeline':ui.workTable?'table':ui.view,unit:ui.unit,selection,
      canUndo:ui.previous.length>0,canRedo:ui.next.length>0};
    const result=await api.agentRun(plan,question,context);
    if(generation!==conversation.generation)return;
    if(!conversation.output?.textContent)appendMessage(result.answer,'assistant');
    showDraft(result.draft,stamp);
    conversation.actions=result.actions;
    if(!result.draft){
      if(JSON.stringify(ui.graph)===stamp)await run(()=>executeInterfaceActions(result.actions));
      else if(result.actions.length)appendMessage('当前图已变化，请重新请求界面操作。','assistant');
    }
  }catch(error){
    if(generation===conversation.generation){
      appendMessage(error.message,'assistant');
      $('agentQuestion').value=question;
    }
  }finally{
    working.remove();
    $('agentMessages').querySelectorAll('.agent-message:empty').forEach(node=>node.remove());
    conversation.output=null;
    conversation.running=false;
    conversation.activeGeneration=null;
    $('agentSend').disabled=$('agentReset').disabled=false;
    $('draftApply').disabled=$('draftPreview').disabled=false;
    $('agentStop').hidden=true;
  }
};

$('draftApply').onclick=()=>{
  if(!conversation.draft)return;
  if(JSON.stringify(ui.graph)!==conversation.planStamp){
    appendMessage('当前计划已修改。请基于当前计划重新试算。','assistant');
    showDraft(null,null);
    return;
  }
  run(async()=>{
    const graph=await api.agentApply(ui.graph,conversation.draft.id);
    await display(graph,{change:true,fitView:true});
    showDraft(null,null);
    appendMessage('网络图草稿已应用，可继续对话或使用撤销。','assistant');
    const actions=conversation.actions;
    conversation.actions=[];
    await executeInterfaceActions(actions);
  });
};

async function executeInterfaceActions(actions){
  for(const action of actions){
    switch(action.action){
      case 'view':{
        const extra=action.view==='timeline'?{timeline:true,workTable:false}:
          action.view==='table'?{timeline:false,workTable:true,view:'time'}:
            {timeline:false,workTable:false,view:action.view};
        await display(ui.graph,{...extra,fitView:true});
        break;
      }
      case 'focus':{
        const nodes=action.kind==='node'?ui.graph.nodes:ui.graph.edges;
        if(!nodes.some(item=>item.id===action.id))throw Error('定位对象已变化。');
        let marker=Array.from($('stage').querySelectorAll('[data-node],[data-edge],[data-activity]')).find(item=>
          item.dataset.node===action.id||item.dataset.edge===action.id||item.dataset.activity===action.id);
        if(!marker||$('canvas').hidden){
          await display(ui.graph,{view:'flow',timeline:false,workTable:false,fitView:true});
          marker=Array.from($('stage').querySelectorAll('[data-node],[data-edge]')).find(item=>
            item.dataset.node===action.id||item.dataset.edge===action.id);
        }
        select(action.kind,action.id);
        marker?.scrollIntoView({block:'center',inline:'center'});
        break;
      }
      case 'layout':
        await display({...ui.graph,direction:action.direction},{forceLayout:true,view:'flow',timeline:false,workTable:false,fitView:true,change:true});
        break;
      case 'undo':await restoreHistory(ui.previous,ui.next);break;
      case 'redo':await restoreHistory(ui.next,ui.previous);break;
      case 'open':await openGraph();return;
      case 'save':await save(false);break;
      case 'save_as':await save(true);break;
      case 'export_svg':if(await api.svg(ui.graph,ui.view==='flow'?ui.critical:ui.view,ui.unit))say('SVG 已导出。');break;
      case 'export_events':if(await api.networkData(ui.graph,ui.unit))say('事件 JSON 已导出。');break;
    }
  }
}

$('draftPreview').onclick=()=>run(async()=>{
  if(!conversation.draft)return;
  const result=await api.agentPreview(ui.graph,conversation.draft.id);
  const parsed=new DOMParser().parseFromString(result.svg,'image/svg+xml');
  if(parsed.documentElement.localName!=='svg')throw Error('草稿预览加载失败。');
  $('draftCanvas').replaceChildren(document.importNode(parsed.documentElement,true));
  $('draftDialog').showModal();
});
$('previewClose').onclick=()=>$('draftDialog').close();
