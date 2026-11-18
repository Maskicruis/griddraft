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

const conversation = {history:[], running:false, output:null, draft:null, planStamp:null, generation:0, activeGeneration:null};
const toolNames={inspect_schedule:'计算工期和关键工作',list_tasks:'查找工序和紧前关系',simulate_durations:'试算工期变更'};

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
  $('draftTitle').textContent='工期试算 '+(draft.before??'待计算')+' → '+draft.after+' 天';
  $('draftChanges').replaceChildren(...draft.changes.map(change=>el('li',change.id+' '+change.label+'　'+(change.before??'未填')+' → '+change.days+' 天')));
}

function resetConversation() {
  conversation.history=[];
  conversation.generation++;
  conversation.output=null;
  showDraft(null,null);
  $('agentMessages').replaceChildren();
  appendMessage('可以查询当前计划的关键线路，或试算指定工序工期变化。','assistant');
}

$('agentOpen').onclick=()=>{
  if(!ui.graph)return;
  $('agentContext').textContent='当前计划 · '+ui.graph.title;
  $('agentDialog').showModal();
  $('agentQuestion').focus();
};
$('agentClose').onclick=()=>$('agentDialog').close();
$('agentReset').onclick=resetConversation;
document.addEventListener('griddraft:plan-opened',()=>{
  if(conversation.running)api.agentStop().catch(()=>{});
  resetConversation();
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
  showDraft(null,null);
  const generation=conversation.generation;
  const stamp=JSON.stringify(ui.graph);
  const plan=ui.graph;
  conversation.running=true;
  conversation.activeGeneration=generation;
  $('agentSend').disabled=$('agentReset').disabled=true;
  $('agentStop').hidden=false;
  $('agentQuestion').value='';
  appendMessage(question,'user');
  const working=appendMessage('正在读取当前计划…','tool');
  conversation.output=appendMessage('','assistant');
  try{
    const result=await api.agentRun(plan,question,conversation.history);
    if(generation!==conversation.generation)return;
    if(!conversation.output?.textContent)appendMessage(result.answer,'assistant');
    conversation.history.push({role:'user',text:question},{role:'assistant',text:result.answer});
    conversation.history=conversation.history.slice(-6);
    showDraft(result.draft,stamp);
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
    const operations=conversation.draft.changes.map(change=>{
      const task=ui.graph.nodes.find(item=>item.id===change.id);
      return {op:'put-node',node:{...task,duration:change.days}};
    });
    await edit(operations);
    showDraft(null,null);
    appendMessage('试算草稿已应用，可使用撤销回到原计划。','assistant');
    $('agentDialog').close();
  });
};
