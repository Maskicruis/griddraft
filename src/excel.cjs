'use strict';

const columns={id:['工作编号','原工作编号','任务编号','编号','id','taskid'],name:['工作名称','任务名称','工序名称','名称','name','taskname'],
  duration:['工期工日','工期天','持续时间','工期','duration','days'],before:['前置工作','紧前工作','前置任务','predecessors','before'],
  after:['后置工作','紧后工作','后置任务','successors','after'],start:['计划开始','开始日期','start'],finish:['计划完成','完成日期','finish'],
  role:['行类型','工作类型','任务类型','role'],parent:['父工作编号','父任务编号','父编号','parentid']};
const clean=value=>String(value??'').trim();
const header=value=>clean(value).toLowerCase().replace(/[\s()（）_]/g,'');
const idPattern=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
function fail(message){throw Object.assign(Error(message),{code:'EXCEL_IMPORT'});}
function mappingFor(headers){return Object.fromEntries(Object.entries(columns).map(([key,names])=>[key,headers.findIndex(value=>names.includes(header(value)))]));}
function scalar(value){
  if(value==null)return null;
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(typeof value==='object'){
    if('formula' in value||'sharedFormula' in value)return value.result===undefined?'#FORMULA_NO_CACHE':scalar(value.result);
    if(value.richText)return value.richText.map(part=>part.text).join('');
    if(value.error)return value.error;
    if(value.text!==undefined)return clean(value.text);
    return '#UNSUPPORTED_CELL';
  }
  return typeof value==='string'?value.slice(0,4000):value;
}
async function readExcel(bytes,name='plan.xlsx'){
  if(!/\.xlsx$/i.test(name))fail('请使用 .xlsx 文件；旧版 .xls 请先另存为 .xlsx。');
  if(bytes.byteLength>16*1024*1024)fail('Excel 文件最大 16 MiB。');
  const Excel=require('exceljs'),book=new Excel.Workbook();
  try{
    // SpreadsheetML permits prefixed element names. Canonicalize that namespace
    // for ExcelJS's reader; values, formulas and relationship namespaces stay intact.
    const JSZip=require('jszip'),zip=await JSZip.loadAsync(Buffer.from(bytes));
    let changed=false,total=0;
    for(const entry of Object.values(zip.files)){
      if(entry.dir)continue;
      const relevant=/^xl\/(?:workbook|styles|sharedStrings|worksheets\/sheet\d+)\.xml$/.test(entry.name),chunks=[];
      await new Promise((resolve,reject)=>{
        const stream=entry.nodeStream('nodebuffer');
        stream.on('data',chunk=>{
          total+=chunk.length;
          if(total>64*1024*1024){
            stream.destroy();reject(Object.assign(Error('Excel展开内容过大，请按单位工程拆分。'),{code:'EXCEL_IMPORT'}));return;
          }
          if(relevant)chunks.push(chunk);
        });
        stream.once('error',reject);stream.once('end',resolve);
      });
      if(!relevant)continue;
      let xml=Buffer.concat(chunks).toString('utf8');
      const match=/xmlns:([A-Za-z][A-Za-z0-9_]*)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/.exec(xml);
      if(match){
        const prefix=match[1];
        xml=xml.replace(new RegExp('<(/?)'+prefix+':','g'),'<$1').replace('xmlns:'+prefix+'=','xmlns=');
        zip.file(entry.name,xml);changed=true;
      }
    }
    const content=changed?await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}):Buffer.from(bytes);
    await book.xlsx.load(content,{ignoreNodes:['drawing','picture','extLst']});
  }
  catch(error){if(error.code==='EXCEL_IMPORT')throw error;fail('无法读取 Excel，请确认文件未加密且为有效的 .xlsx 文件。');}
  if(book.worksheets.length>12)fail('最多支持12个工作表，请拆分工作簿。');
  const sheets=book.worksheets.map(sheet=>{
    if(sheet.rowCount>5000||sheet.columnCount>40)fail('工作表范围超过5000行或40列，请清理多余空白格式后导入。');
    const all=[];
    sheet.eachRow((row,rowNumber)=>all.push({row:rowNumber,cells:Array.from({length:sheet.columnCount},(_,index)=>scalar(row.getCell(index+1).value))}));
    let best=null,score=-1;
    for(const candidate of all.slice(0,30)){
      const map=mappingFor(candidate.cells),points=(map.name>=0?5:0)+(map.duration>=0?5:0)+Object.values(map).filter(n=>n>=0).length;
      if(points>score){score=points;best=candidate;}
    }
    if(!best)return {name:sheet.name,headers:[],headerRow:1,rows:[]};
    const rows=all.filter(row=>row.row>best.row&&row.cells.some(value=>value!==null&&value!==''));
    if(rows.length>1000)fail('每张表最多导入1000条记录，请按单位工程拆分。');
    return {name:sheet.name,headerRow:best.row,headers:best.cells.map(value=>clean(value)),rows};
  });
  return {version:1,kind:'excel-import',name:String(name).slice(0,160),sheets};
}

function normalizeSource(source){
  if(!source||typeof source!=='object'||!Array.isArray(source.headers)||source.headers.length>40||!Array.isArray(source.rows)||source.rows.length>1000)fail('Excel 来源数据无效。');
  const str=(value,max)=>{if(typeof value!=='string'||value.length>max)fail('Excel 来源文字无效。');return value;};
  const headers=source.headers.map(value=>str(value,4000));
  const rows=source.rows.map(row=>{
    if(!Number.isInteger(row.row)||row.row<1||row.row>1048576||!Array.isArray(row.cells)||row.cells.length>40)fail('Excel 来源行无效。');
    const cells=row.cells.map(value=>{
      if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
      return str(value,4000);
    });
    return {row:row.row,cells};
  });
  const mapping={};
  for(const key of Object.keys(columns)){
    const value=source.mapping?.[key]??-1;
    if(!Number.isInteger(value)||value< -1||value>=headers.length)fail('Excel 字段映射无效。');
    mapping[key]=value;
  }
  return {name:str(source.name,160),sheet:str(source.sheet,160),headers,rows,mapping};
}

function analyzeExcel(sheet,mapping=mappingFor(sheet.headers),name='plan.xlsx'){
  const source=normalizeSource({name,sheet:sheet.name,headers:sheet.headers,rows:sheet.rows,mapping});
  mapping=source.mapping;
  const issues=[],warnings=[],records=[];
  const issue=(row,message)=>issues.push({row,message});
  for(const [key,label] of [['id','工作编号'],['name','工作名称'],['duration','工期']])if(mapping[key]<0)issue(null,'缺少“'+label+'”列，请在原软件导出或选择对应字段；工作编号不能以Excel行号替代。');
  const at=(row,key)=>mapping[key]<0?'':row.cells[mapping[key]]??'';
  for(const row of source.rows){
    const id=clean(at(row,'id')),label=clean(at(row,'name')),value=at(row,'duration');
    const duration=typeof value==='number'?value:/^\d+\s*(?:天|工日|d)?$/i.test(clean(value))?parseInt(value,10):NaN;
    const role=clean(at(row,'role')).toLowerCase();
    const summary=['汇总','汇总工作','分组','summary','group','父工作'].includes(role);
    const record={row:row.row,id,label,duration:Number.isFinite(duration)?duration:null,before:clean(at(row,'before')),after:clean(at(row,'after')),
      start:at(row,'start'),finish:at(row,'finish'),role:summary?'summary':'task',parent:clean(at(row,'parent'))};
    records.push(record);
    if(mapping.id>=0&&!idPattern.test(id))issue(row.row,'工作编号为空或不符合编号规则。');
    if(!label||label.length>96)issue(row.row,'工作名称须为1至96字。');
  }
  const ids=new Map();
  for(const record of records){if(record.id&&ids.has(record.id))issue(record.row,'工作编号重复：'+record.id);else if(record.id)ids.set(record.id,record);}
  // Explicit parent links classify summary rows; labels or missing links alone do not.
  for(const record of records)if(record.parent){
    const parent=ids.get(record.parent);
    if(!parent)issue(record.row,'父工作编号不存在：'+record.parent);
    else if(parent===record)issue(record.row,'工作不能以自身作为父工作。');
    else parent.role='summary';
    const seen=new Set([record.id]);let current=record;
    while(current.parent&&ids.has(current.parent)){
      if(seen.has(current.parent)){issue(record.row,'父工作层级存在循环。');break;}
      seen.add(current.parent);current=ids.get(current.parent);
    }
  }
  for(const record of records)if(record.role!=='summary'&&(!Number.isInteger(record.duration)||record.duration<0||record.duration>100000))
    issue(record.row,'工期须为0至100000的整数天，公式单元格须有保存后的计算结果。');
  const edges=[],links=new Map();
  function parseRelations(record,text,direction){
    if(!text)return;
    for(const token of text.split(/[,，;；\n]+/).map(clean).filter(Boolean)){
      const match=ids.has(token)?[token,token]:/^([A-Za-z0-9_][A-Za-z0-9_.-]*?)(?:(FS|SS|FF|SF)(?:\s*([+-])\s*(\d+)\s*(?:天|工日|d)?)?)?$/i.exec(token);
      if(!match){issue(record.row,'关系文本不完整或格式无法识别：'+token);continue;}
      const ref=match[1],type=(match[2]??'FS').toUpperCase(),lag=match[4]?Number(match[4])*(match[3]==='-'?-1:1):0;
      if(type!=='FS'||lag<0){issue(record.row,'保留但尚不支持计算的关系：'+token+'；当前引擎支持FS和非负时滞。');continue;}
      if(mapping.id<0)continue;
      const other=ids.get(ref);
      if(!other){issue(record.row,'无法定位原工作编号：'+ref);continue;}
      if(record.role==='summary'||other.role==='summary'){issue(record.row,'关系引用了汇总工作，请改为明确的入口／完成工序：'+token);continue;}
      const from=direction==='before'?ref:record.id,to=direction==='before'?record.id:ref;
      if(from===to){issue(record.row,'工作不能依赖自身：'+token);continue;}
      const key=JSON.stringify([from,to]);
      if(links.has(key)){
        if(links.get(key).lag!==lag)issue(record.row,'前后置关系中的时滞不一致：'+from+' → '+to);
      }else{
        const edge={id:'XL'+(edges.length+1),from,to,lag,label:''};links.set(key,edge);edges.push(edge);
      }
    }
  }
  for(const record of records){parseRelations(record,record.before,'before');parseRelations(record,record.after,'after');}
  if(mapping.role<0&&mapping.parent<0)warnings.push('未提供“行类型／父工作编号”，不会凭名称猜测汇总行；如含汇总工作，请补充层级或行类型后生成。');
  if(mapping.start>=0||mapping.finish>=0)warnings.push('原计划日期已保留作为基准。计算图按逻辑日与工期重算，当前未导入原软件工作日历。');
  const tasks=records.filter(record=>record.role!=='summary');
  if(!tasks.length)issue(null,'没有可计算的具体工序。');
  let graph=null;
  if(!issues.length){
    try{
      const engine=require('./engine.cjs');
      graph=engine.normalize({version:1,title:name.replace(/\.xlsx$/i,'')+' · '+sheet.name,nodes:tasks.map(record=>({id:record.id,label:record.label,
        kind:record.duration===0?'milestone':'task',duration:record.duration,estimated:false})),edges,importSource:source});
      engine.cpm(graph);
    }catch(error){issue(null,error.message);graph=null;}
  }
  return {source,records,issues,warnings,graph,summary:{records:records.length,tasks:tasks.length,groups:records.length-tasks.length,relations:edges.length}};
}
module.exports={readExcel,analyzeExcel,mappingFor,normalizeSource,columns};
