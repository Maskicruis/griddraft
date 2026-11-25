'use strict';

const types={wind:'风机',substation:'升压站',collector:'集电线路',road:'道路'};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,39}$/.test(value);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function check(ok,message){if(!ok)throw Error(message);}
function words(value,limit,fallback=''){
  const text=typeof value==='string'?value.trim():fallback;
  check(text.length<=limit&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text),'项目信息文字过长或包含无效字符。');
  return text;
}

function chain(rows){
  return rows.map(([id,label],index)=>({id,label,duration:1,estimated:true,after:index?[rows[index-1][0]]:[]}));
}
function templates({foundation='unknown',lineMethod='unknown'}={}){
  const wind=[['survey','测量放样与场地准备']];
  if(foundation==='pile')wind.push(['pile','桩基施工'],['pile_check','桩基检测与验收']);
  wind.push(['excavate','基坑开挖与验槽'],['blinding','垫层施工'],['reinforce','钢筋与锚栓安装'],['pour','混凝土浇筑'],
    ['cure','养护与基础验收'],['erect','塔筒机舱及叶轮安装'],['electric','箱变及机组电气安装'],
    ['cold','机组静态调试'],['grid','机组并网调试']);
  const station=chain([['survey','测量与站区准备'],['civil','土建与设备基础施工'],['install','一次设备安装'],
    ['secondary','二次系统与接线'],['test','系统试验与保护调试'],['ready','升压站受电条件确认']]);
  station.splice(2,0,{id:'delivery',label:'主设备到货与开箱验收',duration:1,estimated:true,after:['survey']});
  station.find(step=>step.id==='install').after=['civil','delivery'];
  return {
    wind:{name:'风机工程',entry:'survey',ready:'cold',finish:'grid',steps:chain(wind)},
    substation:{name:'升压站工程',entry:'survey',ready:'ready',finish:'ready',steps:station},
    collector:{name:lineMethod==='overhead'?'架空集电线路':'电缆集电线路',entry:'survey',ready:'test',finish:'test',
      steps:chain(lineMethod==='overhead'?
        [['survey','路径复测与施工准备'],['civil','杆塔基础施工与验收'],['erect','杆塔组立'],['string','导地线与光缆架设'],['test','线路试验与验收']]:
        [['survey','路径复测与施工准备'],['civil','沟槽与保护管施工'],['lay','电缆敷设'],['terminal','终端与接头制作'],['test','电缆试验与验收']])},
    road:{name:'场内交通工程',entry:'survey',ready:'handover',finish:'handover',
      steps:chain([['survey','放样与道路施工准备'],['earth','路基与排水施工'],['surface','路面与吊装通行条件完善'],['handover','通行条件确认']])}
  };
}

function normalizeTemplate(input,type){
  check(plain(input)&&Array.isArray(input.steps)&&input.steps.length>0&&input.steps.length<=40,'模块模板需要 1 至 40 道工序。');
  const ids=new Set(input.steps.map(step=>step?.id));
  check(ids.size===input.steps.length&&[...ids].every(validId),'模板工序编号无效或重复。');
  const steps=input.steps.map(step=>{
    check(words(step.label,80),'模板工序名称不能为空。');
    check(Number.isInteger(step.duration)&&step.duration>=0&&step.duration<=100000,'模板工期须为非负整数天。');
    check(Array.isArray(step.after)&&new Set(step.after).size===step.after.length&&step.after.every(id=>ids.has(id)&&id!==step.id),'模板紧前工序无效。');
    return {id:step.id,label:step.label.trim(),duration:step.duration,estimated:step.estimated!==false,after:step.after.slice()};
  });
  for(const key of ['entry','ready','finish'])check(ids.has(input[key]),'模板缺少 '+key+' 端点。');
  const done=new Set();
  while(done.size<steps.length){
    const ready=steps.filter(step=>!done.has(step.id)&&step.after.every(id=>done.has(id)));
    check(ready.length,'模块模板存在循环关系。');
    for(const step of ready)done.add(step.id);
  }
  const successors=id=>steps.filter(step=>step.after.includes(id)).map(step=>step.id);
  const reachable=(start,target)=>{
    const pending=[start],seen=new Set();
    while(pending.length){const id=pending.pop();if(id===target)return true;if(!seen.has(id)){seen.add(id);pending.push(...successors(id));}}
    return false;
  };
  check(steps.every(step=>reachable(input.entry,step.id)&&reachable(step.id,input.finish)),'模板工序须全部连接入口与完成端点。');
  return {name:words(input.name,60,types[type]),entry:input.entry,ready:input.ready,finish:input.finish,steps};
}

function normalizeProject(input){
  check(plain(input)&&input.version===1,'项目基本信息需要 version: 1。');
  const name=words(input.name,100);
  check(name,'请填写项目名称。');
  check(Array.isArray(input.units)&&input.units.length>0&&input.units.length<=50,'请至少填写一类工程的数量。');
  const units=input.units.map((unit,index)=>{
    check(plain(unit)&&Object.hasOwn(types,unit.type),'工程类型只支持 wind、substation、collector、road。');
    check(Number.isInteger(unit.count)&&unit.count>=1&&unit.count<=200,'工程数量须为 1 至 200 的整数。');
    const prefix=unit.prefix??{wind:'WT',substation:'SS',collector:'CL',road:'RD'}[unit.type];
    check(validId(prefix),'工程编号前缀无效。');
    const lengthKm=unit.lengthKm??null;
    check(lengthKm===null||Number.isFinite(lengthKm)&&lengthKm>=0&&lengthKm<=100000,'线路或道路长度无效。');
    return {type:unit.type,count:unit.count,prefix,label:words(unit.label,60,types[unit.type]),
      lengthKm,aggregate:unit.aggregate===true};
  });
  const foundation=input.foundation??'unknown',lineMethod=input.lineMethod??'unknown';
  check(['unknown','spread','pile'].includes(foundation),'基础类型无效。');
  check(['unknown','cable','overhead'].includes(lineMethod),'集电线路类型无效。');
  const defaults=templates({foundation,lineMethod}),catalog={};
  for(const type of Object.keys(types))catalog[type]=normalizeTemplate(input.templates?.[type]??defaults[type],type);
  const instances=units.flatMap(unit=>Array.from({length:unit.count},(_,i)=>unit.prefix+String(i+1).padStart(2,'0')));
  check(new Set(instances).size===instances.length,'不同工程的编号前缀发生冲突，请更改前缀。');
  const total=units.reduce((n,unit)=>n+unit.count*catalog[unit.type].steps.length,3);
  check(total<=1000,'展开后超过 1000 道工序，请拆分项目或减少模板工序。');
  return {version:1,kind:'project-brief',name,description:words(input.description,12000),foundation,lineMethod,units,templates:catalog};
}

function generateProject(input){
  const project=normalizeProject(input);
  const nodes=[{id:'PROJECT.START',label:'项目开工条件确认',kind:'milestone',duration:0},
    {id:'PROJECT.ENERGIZE',label:'全场受电及并网条件确认',kind:'milestone',duration:0},
    {id:'PROJECT.FINISH',label:'全场调试与移交完成',kind:'milestone',duration:0}];
  const edges=[],instances=[];
  const link=(from,to,label='')=>edges.push({id:'L'+String(edges.length+1),from,to,lag:0,label});
  for(const group of project.units)for(let i=1;i<=group.count;i++){
    const id=group.prefix+String(i).padStart(2,'0'),template=project.templates[group.type];
    instances.push({id,type:group.type,entry:id+'.'+template.entry,ready:id+'.'+template.ready,finish:id+'.'+template.finish});
    for(const step of template.steps){
      nodes.push({id:id+'.'+step.id,label:id+' '+step.label,kind:'task',duration:step.duration,
        unit:id,unitType:group.type,estimated:step.estimated});
      for(const before of step.after)link(id+'.'+before,id+'.'+step.id);
    }
    link('PROJECT.START',id+'.'+template.entry);
  }
  const roads=instances.filter(unit=>unit.type==='road');
  for(const unit of instances){
    // Common access and full-field energization are explicit planning assumptions.
    if(unit.type!=='road')for(const road of roads)link(road.finish,unit.entry,'通行条件');
    link(unit.ready,'PROJECT.ENERGIZE','受电前置条件');
    if(unit.type==='wind')link('PROJECT.ENERGIZE',unit.finish,'并网许可');
    link(unit.finish,'PROJECT.FINISH');
  }
  link('PROJECT.ENERGIZE','PROJECT.FINISH');
  const assumptions=['模板工期为规划占位值，须按工程量、资源、养护及验收条件重新估算。',
    '各单位工程先按并行安排；道路作为共同通行前置，受电节点汇合全场条件。分区移交和分批并网关系需按设计调整。',
    '线路长度只保存为项目信息，当前未据此推算工程量或工期。'];
  if(project.foundation==='unknown')assumptions.push('基础型式未确认，当前采用浅基础工序骨架。');
  if(project.lineMethod==='unknown')assumptions.push('线路型式未确认，当前采用电缆集电线路骨架。');
  if(project.units.some(unit=>unit.aggregate))assumptions.push('部分工程按总体模块展开，模块数代表规划分组。');
  const engine=require('./engine.cjs');
  const graph=engine.normalize({version:1,title:project.name+' · 模板网络初稿',direction:'RIGHT',project,nodes,edges});
  engine.cpm(graph);
  return {graph,units:instances,assumptions,estimated:nodes.filter(node=>node.estimated).length};
}

function unitGraph(input,unit){
  const nodes=input.nodes.filter(node=>node.unit===unit);
  check(nodes.length,'单位工程不存在。');
  const ids=new Set(nodes.map(node=>node.id));
  return {...input,title:unit+' · 单位工程内部网络',nodes,edges:input.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to))};
}

function number(text){
  if(/^\d+(\.\d+)?$/.test(text))return Number(text);
  const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  let result=0,current=0;
  for(const char of text){
    if(Object.hasOwn(digits,char))current=digits[char];
    else if(char==='十'||char==='百'){result+=(current||1)*(char==='十'?10:100);current=0;}
    else return NaN;
  }
  return result+current;
}

function delimited(raw,delimiter){
  const rows=[],row=[];let cell='',quoted=false;
  for(let i=0;i<=raw.length;i++){
    const char=raw[i]??'\n';
    if(char==='"'){
      if(quoted&&raw[i+1]==='"'){cell+='"';i++;}
      else quoted=!quoted;
    }else if(!quoted&&(char===delimiter||char==='\n')){
      row.push(cell.replace(/\r$/,''));cell='';
      if(char==='\n'){if(row.some(value=>value.trim()))rows.push(row.splice(0));else row.length=0;}
    }else cell+=char;
  }
  check(!quoted,'表格引号未闭合。');
  return rows;
}

function fieldProject(entries,description){
  const units=new Map(),notes=[];
  let name='新建风电项目';
  const typeFor=key=>/风机|风电机组|turbine|^wind/i.test(key)?'wind':
    /升压站|变电站|substation|booster/i.test(key)?'substation':
      /集电|collector/i.test(key)?'collector':/道路|交通|road/i.test(key)?'road':null;
  for(const [rawKey,value] of entries){
    const key=String(rawKey).replace(/[\s_()-]/g,'');
    if(/^(项目名称|项目名|name|projectname)$/i.test(key)){name=String(value);continue;}
    if(/容量|功率|capacity|voltage|电压|风速|speed|高度|height|型号|model/i.test(key))continue;
    const type=typeFor(key);
    if(!type)continue;
    const unit=units.get(type)??{type};
    if(/长度|length/i.test(key)){
      const length=String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(?:km|千米|公里)?$/i);
      if(length)unit.lengthKm=Number(length[1]);
      else notes.push(rawKey+'需要填写确切公里数。');
    }else{
      const count=String(value).trim().match(/^([0-9零〇一二两三四五六七八九十百]+)\s*(?:台|座|个|条|段|回路|回)?$/);
      if(count)unit.count=number(count[1]);else notes.push(rawKey+'数量需要确认。');
    }
    units.set(type,unit);
  }
  const groups=[];
  for(const unit of units.values()){
    if(!unit.count&&unit.type==='collector'&&unit.lengthKm){unit.count=1;unit.aggregate=true;notes.push('回路数量未提供，集电线路按一个总体模块。');}
    if(unit.count>0)groups.push(unit);
  }
  return {version:1,kind:'project-brief',name,description,units:groups,notes,foundation:'unknown',lineMethod:'unknown'};
}

function parseProject(raw,format='auto'){
  check(typeof raw==='string'&&raw.trim()&&raw.length<=500000,'请粘贴 1 至 500000 字的项目信息。');
  raw=raw.replace(/^\uFEFF/,'').trim();
  if(format==='json'||format==='auto'&&raw.startsWith('{')){
    let data;try{data=JSON.parse(raw);}catch{throw Error('项目 JSON 格式无效。');}
    if(data.units)return normalizeProject({...data,kind:'project-brief',version:data.version??1});
    check(plain(data),'项目 JSON 需要对象。');
    return fieldProject(Object.entries(data),raw);
  }
  const units=[],notes=[];
  const aliases={wind:'风机|风电机组|风力发电机组|wind(?: turbine)?s?',substation:'升压站|变电站|booster station|substation',
    collector:'集电线路|集电回路|collector(?: line)?s?',road:'场内道路|场内交通|道路|roads?'};
  const typeOf=value=>Object.keys(aliases).find(type=>new RegExp(aliases[type],'i').test(value));
  let name='',description=raw;
  const firstLine=raw.split('\n')[0];
  const tableHeader=firstLine.split(/[,\t]/).some(cell=>/^(类型|工程|工程类型|数量|模块数|参数|值|项目名称|type|count|quantity|value|projectname|[A-Za-z]+Count|[A-Za-z]+LengthKm|.{1,12}数量|.{1,12}长度(?:km)?)$/i.test(cell.trim().replace(/^"|"$/g,'')));
  if(format==='csv'||format==='tsv'||format==='auto'&&raw.includes('\n')&&/[,\t]/.test(firstLine)&&tableHeader){
    const rows=delimited(raw,format==='tsv'||raw.split('\n')[0].includes('\t')?'\t':',');
    const headerRow=rows.shift()??[];
    const headers=headerRow.map(value=>value.trim().toLowerCase());
    const typeCol=headers.findIndex(header=>/^(类型|工程类型|工程|type)$/.test(header));
    const countCol=headers.findIndex(header=>/^(数量|模块数|count|quantity)$/.test(header));
    const lengthCol=headers.findIndex(header=>/长度|length/.test(header));
    if(typeCol<0||countCol<0){
      const wide=headers.some(header=>typeOf(header));
      if(wide&&rows.length===1)return fieldProject(headers.map((header,index)=>[header,rows[0][index]??'']),raw);
      const pairs=[headerRow,...rows].filter(row=>row.length===2);
      const parsed=fieldProject(pairs,raw);
      check(parsed.units.length,'未识别到工程数量，请使用“类型、数量”列或两列参数表。');
      return parsed;
    }
    for(const [index,row] of rows.entries()){
      const type=typeOf(row[typeCol]??'');
      check(type,'表格第 '+(index+2)+' 行工程类型无法识别。');
      const value=row[countCol]?.trim(),count=number(value??'');
      check(value&&Number.isInteger(count)&&count>0,'表格第 '+(index+2)+' 行数量无效。');
      const length=row[lengthCol]?.trim();
      units.push({type,count,...(length?{lengthKm:Number(length)}:{})});
    }
  }else{
    name=/^(?:项目名称|项目名|project name)\s*[:：]\s*([^\n，。,;；]+)/im.exec(raw)?.[1]??'';
    const digits='[0-9零〇一二两三四五六七八九十百]+';
    const ambiguous=/[0-9零〇一二两三四五六七八九十百]+\s*[-~～至到]\s*[0-9零〇一二两三四五六七八九十百]+\s*(?:台|座|回|个|条|段)/g;
    const searchable=raw.replace(ambiguous,()=>{notes.push('数量区间需在表单中填写确切值。');return '数量待确认';});
    for(const [type,alias] of Object.entries(aliases)){
      const values=[];
      const expression=new RegExp('(?<![0-9零〇一二两三四五六七八九十百数几])('+digits+')\\s*(?:台|座|个|条|回路|回|段)?\\s*(?:'+alias+')|(?:'+alias+')\\s*(?:数量|总数)?\\s*[:：为有共计]*\\s*('+digits+')\\s*(?:台|座|个|条|回路|回|段|(?=[\\s,，。;；]|$))','gi');
      for(const match of searchable.matchAll(expression))values.push(number(match[1]??match[2]));
      const unique=[...new Set(values)];
      if(unique.length===1&&unique[0]>0)units.push({type,count:unique[0]});
      else if(unique.length>1)notes.push(types[type]+'数量出现多个值，请在表单确认。');
    }
    const length=/(?:集电线路|集电回路)[^。；\n]{0,18}?(\d+(?:\.\d+)?)\s*(?:km|公里|千米)/i.exec(raw)?.[1];
    if(length){
      let collector=units.find(unit=>unit.type==='collector');
      // A length is a quantity of work, not a count of circuits.
      if(!collector){collector={type:'collector',count:1,aggregate:true};units.push(collector);notes.push('未提供回路数，集电线路暂按一个总体模块。');}
      collector.lengthKm=Number(length);
    }
    if(/若干|几个|数台|数百|几百/.test(raw))notes.push('模糊数量需要在表单中补充或确认。');
  }
  check(new Set(units.map(unit=>unit.type)).size===units.length,'同一类型有多行分组，请使用 JSON 指定不同 prefix。');
  return {version:1,kind:'project-brief',name:name||'新建风电项目',description,units,notes,
    foundation:/桩基|灌注桩/.test(raw)?'pile':'unknown',
    lineMethod:/架空/.test(raw)?'overhead':/电缆/.test(raw)?'cable':'unknown'};
}

module.exports={types,templates,normalizeTemplate,normalizeProject,parseProject,generateProject,unitGraph};
