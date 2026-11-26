'use strict';

const {normalize,cpm,GraphError}=require('./engine.cjs');
const {types}=require('./project.cjs');
const ELK=require('elkjs/lib/elk.bundled.js');
const sort=rows=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const local=(id,unit)=>id.startsWith(unit+'.')?id.slice(unit.length+1):id;
const label=(node,unit)=>node.label.startsWith(unit+' ')?node.label.slice(unit.length+1):node.label;

// Equivalence deliberately includes external endpoint IDs: connected or differently
// constrained instances must not be combined just because their labels look alike.
function buildSummary(input){
  const graph=normalize(input),analysis=cpm(graph);
  const timing=new Map(analysis.nodes.map(row=>[row.id,row]));
  const byId=new Map(graph.nodes.map(node=>[node.id,node]));
  const units=new Map();
  for(const node of graph.nodes)if(node.unit){
    if(!units.has(node.unit))units.set(node.unit,[]);
    units.get(node.unit).push(node);
  }
  const equivalent=new Map();
  for(const [unit,nodes] of units){
    const ids=new Set(nodes.map(node=>node.id));
    const internal=graph.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to));
    const boundary=graph.edges.filter(edge=>ids.has(edge.from)!==ids.has(edge.to));
    const signature=JSON.stringify({
      nodes:sort(nodes.map(node=>[local(node.id,unit),label(node,unit),node.kind,node.duration,node.estimated??false,node.unitType])),
      edges:sort(internal.map(edge=>[local(edge.from,unit),local(edge.to,unit),edge.lag,edge.label])),
      boundary:sort(boundary.map(edge=>ids.has(edge.from)?['out',local(edge.from,unit),edge.to,edge.lag,edge.label]:
        ['in',edge.from,local(edge.to,unit),edge.lag,edge.label]))
    });
    if(!equivalent.has(signature))equivalent.set(signature,{units:[],nodes,internal,boundary});
    equivalent.get(signature).units.push(unit);
  }
  const nodes=[],edges=[],groups=[],mapping=new Map();
  function addNode(row,sourceIds){
    const times=sourceIds.map(id=>timing.get(id));
    const result={id:'S'+(nodes.length+1),...row,sourceIds,
      es:Math.min(...times.map(t=>t.es)),ef:Math.max(...times.map(t=>t.ef)),
      critical:times.some(t=>t.tf===0),estimated:sourceIds.some(id=>byId.get(id).estimated===true)};
    nodes.push(result);for(const id of sourceIds)mapping.set(id,result.id);
    return result;
  }
  for(const node of graph.nodes)if(!node.unit)addNode({label:node.label,kind:node.kind,units:[]},[node.id]);
  for(const item of equivalent.values()){
    const unit=item.units[0],pending=new Map(item.nodes.map(node=>[node.id,0]));
    for(const edge of item.internal)pending.set(edge.to,pending.get(edge.to)+1);
    const ready=item.nodes.filter(node=>pending.get(node.id)===0),order=[];
    while(ready.length){
      ready.sort((a,b)=>local(a.id,unit).localeCompare(local(b.id,unit)));
      const node=ready.shift();order.push(node);
      for(const edge of item.internal.filter(edge=>edge.from===node.id)){
        pending.set(edge.to,pending.get(edge.to)-1);
        if(pending.get(edge.to)===0)ready.push(byId.get(edge.to));
      }
    }
    const incoming=new Set(item.boundary.filter(edge=>byId.get(edge.to).unit===unit).map(edge=>edge.to));
    const outgoing=new Set(item.boundary.filter(edge=>byId.get(edge.from).unit===unit).map(edge=>edge.from));
    // Cut before every external entrance and after every external exit. Contiguous
    // topological sections keep the projected network acyclic and expose all gates.
    const stages=[];let current=[];
    for(const node of order){
      if(incoming.has(node.id)&&current.length){stages.push(current);current=[];}
      current.push(node);
      if(outgoing.has(node.id)){stages.push(current);current=[];}
    }
    if(current.length)stages.push(current);
    const group={id:'G'+(groups.length+1),units:item.units,type:item.nodes[0].unitType,stages:[]};
    for(const [index,stage] of stages.entries()){
      const keys=new Set(stage.map(node=>local(node.id,unit)));
      const sourceIds=item.units.flatMap(id=>units.get(id).filter(node=>keys.has(local(node.id,id))).map(node=>node.id));
      const node=addNode({label:types[group.type]+' · '+item.units.length+' 个'+(item.units.length>1?'重复':'单位')+'模块',
        kind:'module',group:group.id,units:item.units,stage:index+1,stageCount:stages.length,
        stepCount:stage.length,first:label(stage[0],unit),last:label(stage.at(-1),unit)},sourceIds);
      group.stages.push(node.id);
    }
    groups.push(group);
  }
  const merged=new Map(),critical=new Set(analysis.criticalEdges);
  for(const edge of graph.edges){
    const from=mapping.get(edge.from),to=mapping.get(edge.to);
    if(from===to)continue;
    const key=JSON.stringify([from,to,edge.lag,edge.label]);
    if(!merged.has(key)){
      const row={id:'R'+(edges.length+1),from,to,lag:edge.lag,label:edge.label,sourceIds:[],critical:false};
      merged.set(key,row);edges.push(row);
    }
    const row=merged.get(key);row.sourceIds.push(edge.id);row.critical||=critical.has(edge.id);
  }
  // This is a display projection. Only the source network supplies schedule values.
  cpm({version:1,title:'汇总关系检查',nodes:nodes.map(n=>({id:n.id,label:n.label,duration:0})),edges});
  return {version:1,kind:'module-summary',title:graph.title,duration:analysis.duration,
    sourceNodeCount:graph.nodes.length,estimatedCount:graph.nodes.filter(n=>n.estimated).length,
    repeatedGroups:groups.filter(group=>group.units.length>1).length,groups,nodes,edges};
}

const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const short=(text,n=23)=>[...text].slice(0,n).join('')+([...text].length>n?'…':'');
async function renderSummary(summary,{animated=false,embedMotionStyle=true}={}){
  if(summary.kind!=='module-summary')throw new GraphError('INVALID_SUMMARY','需要模块汇总数据。');
  const output=await new ELK().layout({id:'summary',layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN',
    'elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'24','elk.layered.spacing.nodeNodeBetweenLayers':'36','elk.randomSeed':'1'},
    children:summary.nodes.map(node=>({id:node.id,width:node.kind==='module'?280:224,height:node.kind==='module'?112:70})),
    edges:summary.edges.map(edge=>({id:edge.id,sources:[edge.from],targets:[edge.to]}))});
  const width=Math.max(860,Math.ceil((output.width||0)+40)),height=Math.max(330,Math.ceil((output.height||0)+150));
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="Microsoft YaHei UI, Segoe UI, sans-serif">`,
    `<title>${escape(summary.title)} — 重复模块汇总网络</title><rect width="${width}" height="${height}" fill="#fbfdff"/>`,
    `<text x="22" y="34" font-size="21" font-weight="700" fill="#15314a">${escape(summary.title)} · 模块总览</text>`,
    `<text x="22" y="60" font-size="13" fill="#516a82">${summary.sourceNodeCount} 个源节点 → ${summary.nodes.length} 个汇总节点 · 源网络${summary.estimatedCount?'占位':''}工期 ${summary.duration} 天 · ${summary.repeatedGroups} 组重复模块</text>`,
    '<defs><marker id="summaryArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#5283a6"/></marker></defs><g transform="translate(20 88)">'];
  if(animated&&embedMotionStyle)parts.push(require('./time-layout.cjs').motionStyle);
  for(const edge of output.edges??[]){
    const source=summary.edges.find(row=>row.id===edge.id);
    for(const section of edge.sections??[]){
      const points=[section.startPoint,...(section.bendPoints??[]),section.endPoint];
      const d=points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ');
      parts.push(`<g><title>${escape(source.label||'源网络依赖')} · 时滞 ${source.lag} 天 · ${source.sourceIds.length} 条源关系</title><path d="${d}" fill="none" stroke="${source.critical?'#b94440':'#5283a6'}" stroke-width="2" marker-end="url(#summaryArrow)"/></g>`);
      if(animated)parts.push(`<path d="${d}" class="network-flow" stroke="${source.critical?'#b94440':'#5283a6'}"/>`);
    }
  }
  for(const item of output.children){
    const node=summary.nodes.find(row=>row.id===item.id),module=node.kind==='module';
    const color=node.critical?'#b94440':'#28749a';
    const members=node.units.length?node.units[0]+(node.units.length>1?' … '+node.units.at(-1):''):'';
    parts.push(`<g ${module?`data-module="${node.id}" data-unit="${escape(node.units[0])}" role="link" tabindex="0" aria-label="进入 ${escape(members)}"`:`data-source="${escape(node.sourceIds[0])}"`} transform="translate(${item.x} ${item.y})" style="cursor:${module?'pointer':'default'}"><title>${escape(node.units.join('、')||node.label)}\n${escape(node.first??'')} → ${escape(node.last??'')}\n源节点：${escape(node.sourceIds.join('、'))}</title>`,
      `<rect width="${item.width}" height="${item.height}" rx="12" fill="${module?'#edf6fc':'#f5f8fb'}" stroke="${color}" stroke-width="1.6"/>`,
      `<text x="15" y="26" font-size="15" font-weight="700" fill="#16334f">${escape(short(node.label))}</text>`);
    if(module)parts.push(`<text x="15" y="48" font-size="12" fill="${color}">${escape(members)}${node.stageCount>1?' · 分段 '+node.stage+'/'+node.stageCount:''}</text>`,
      `<text x="15" y="70" font-size="12" fill="#516a82">${escape(short(node.first===node.last?node.first:node.first+' → '+node.last,21))}</text>`,
      `<text x="15" y="94" font-size="12" fill="#28749a">D${node.es}–D${node.ef} · 每个 ${node.stepCount} 道工序 · 点击进入 ›</text>`);
    else parts.push(`<text x="15" y="53" font-size="12" fill="#516a82">D${node.es}–D${node.ef} · 源节点</text>`);
    parts.push('</g>');
  }
  parts.push(`</g><text x="22" y="${height-18}" font-size="12" fill="#516a82">汇总视图用于导航 · 工期与关键工作按完整源网络计算 · 外部控制点分段保留 · 详细工序见单位工程网络</text></svg>`);
  return parts.join('\n');
}

module.exports={buildSummary,renderSummary};
