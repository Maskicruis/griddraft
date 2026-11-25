'use strict';

const ELK = require('elkjs/lib/elk.bundled.js');
const {normalizeProject}=require('./project.cjs');
const elk = new ELK();
const size = { width:172, height:58 };
const kinds = new Set(['task','milestone','decision']);
const directions = new Set(['RIGHT','DOWN','LEFT','UP']);

class GraphError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function requireValue(ok, message) { if (!ok) throw new GraphError('INVALID_GRAPH',message); }
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const idOf = x => typeof x === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(x);
const text = (x, max) => typeof x === 'string' && x.length <= max && x.isWellFormed() &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(x);
const coordinate = x => Number.isFinite(x) && Math.abs(x) <= 1e6;
const integer = x => Number.isInteger(x) && x >= 0 && x <= 100000;
const point = p => object(p) && coordinate(p.x) && coordinate(p.y);

function normalize(input) {
  requireValue(object(input) && input.version === 1,'图文件须声明 version: 1。');
  requireValue(text(input.title,120) && input.title.trim(),'title 须为 1 至 120 字。');
  requireValue(directions.has(input.direction ?? 'RIGHT'),'direction 不支持。');
  requireValue(Array.isArray(input.nodes) && input.nodes.length <= 1000,'nodes 须为数组，最多 1000 项。');
  requireValue(Array.isArray(input.edges) && input.edges.length <= 5000,'edges 须为数组，最多 5000 项。');
  const nodes = input.nodes.map((n,i) => {
    const at='nodes['+i+']';
    requireValue(object(n) && idOf(n.id), at+' 编号无效。');
    requireValue(text(n.label,96) && n.label.trim(), at+' 名称须为 1 至 96 字。');
    requireValue(kinds.has(n.kind ?? 'task'),at+' 类型无效。');
    if (n.duration !== undefined) requireValue(integer(n.duration) && (n.kind!=='milestone' || n.duration===0),at+' 工期无效，里程碑工期须为 0。');
    if (n.position !== undefined) requireValue(point(n.position),at+' 坐标无效。');
    if(n.unit!==undefined)requireValue(idOf(n.unit)&&['wind','substation','collector','road'].includes(n.unitType),at+' 单位工程信息无效。');
    if(n.estimated!==undefined)requireValue(typeof n.estimated==='boolean',at+' 工期来源无效。');
    return { id:n.id,label:n.label.trim(),kind:n.kind ?? 'task',...(n.duration === undefined?{}:{duration:n.duration}),
      ...(n.position?{position:{x:n.position.x,y:n.position.y}}:{}),
      ...(n.unit?{unit:n.unit,unitType:n.unitType}:{}),...(n.estimated===undefined?{}:{estimated:n.estimated}) };
  });
  const ids=new Set(nodes.map(n=>n.id));
  const nodeById=new Map(nodes.map(n=>[n.id,n]));
  requireValue(ids.size === nodes.length,'存在重复节点编号。');
  const edges = input.edges.map((e,i) => {
    const at='edges['+i+']';
    requireValue(object(e)&&idOf(e.id),at+' 编号无效。');
    requireValue(ids.has(e.from)&&ids.has(e.to),at+' 的起点或终点不存在。');
    requireValue(text(e.label ?? '',80),at+' 说明过长。');
    requireValue(integer(e.lag ?? 0),at+' 时滞须为非负整数。');
    if (e.points !== undefined) {
      requireValue(Array.isArray(e.points)&&e.points.length>=2&&e.points.length<=256&&e.points.every(point),at+' 折线路径无效。');
      requireValue(nodeById.get(e.from).position&&nodeById.get(e.to).position,at+' 路径需要有效节点位置。');
    }
    return {id:e.id,from:e.from,to:e.to,label:e.label ?? '',lag:e.lag ?? 0,
      ...(e.points?{points:e.points.map(p=>({x:p.x,y:p.y}))}:{})};
  });
  requireValue(new Set(edges.map(e=>e.id)).size === edges.length,'存在重复连线编号。');
  return {version:1,title:input.title.trim(),direction:input.direction ?? 'RIGHT',nodes,edges,
    ...(input.project?{project:normalizeProject(input.project)}:{})};
}

function cpm(input) {
  const graph=normalize(input), byId=new Map(), ready=[];
  for(const n of graph.nodes) {
    if(n.duration===undefined&&n.kind!=='milestone') throw new GraphError('MISSING_DURATION',n.id+' 缺少 duration。');
    byId.set(n.id,{id:n.id,duration:n.duration ?? 0,pending:0,next:[],es:0});
  }
  for(const e of graph.edges) {
    byId.get(e.from).next.push(e);
    byId.get(e.to).pending++;
  }
  for(const n of byId.values())if(n.pending===0)ready.push(n);
  let finish=0;
  for(let i=0;i<ready.length;i++) {
    const task=ready[i];
    task.ef=task.es+task.duration;
    finish=Math.max(finish,task.ef);
    for(const e of task.next) {
      const next=byId.get(e.to);
      next.es=Math.max(next.es,task.ef+e.lag);
      if(--next.pending===0)ready.push(next);
    }
  }
  if(ready.length!==byId.size)throw new GraphError('CYCLE','图中有循环关系，无法计算关键路径。');
  for(const t of ready.slice().reverse()){
    t.lf=t.next.length?Math.min(...t.next.map(e=>byId.get(e.to).ls-e.lag)):finish;
    t.ls=t.lf-t.duration;
    t.tf=t.ls-t.es;
    t.ff=(t.next.length?Math.min(...t.next.map(e=>byId.get(e.to).es-e.lag)):finish)-t.ef;
  }
  return {duration:finish,nodes:[...byId.values()].map(({id,es,ef,ls,lf,tf,ff})=>({id,es,ef,ls,lf,tf,ff})),
    criticalEdges:graph.edges.filter(e=>{
      const a=byId.get(e.from),b=byId.get(e.to);
      return a.tf===0&&b.tf===0&&a.ef+e.lag===b.es;
    }).map(e=>e.id)};
}

async function layout(input,{direction}={}) {
  const graph=normalize(input);
  if(direction!==undefined)requireValue(directions.has(direction),'direction 不支持。');
  graph.direction=direction ?? graph.direction;
  if(!graph.nodes.length)return graph;
  const index=new Map(graph.nodes.map((n,i)=>[n.id,'n'+i]));
  const model={
    id:'diagram',layoutOptions:{'elk.algorithm':'layered','elk.direction':graph.direction,'elk.edgeRouting':'ORTHOGONAL',
      'elk.spacing.nodeNode':'30','elk.layered.spacing.nodeNodeBetweenLayers':'56','elk.randomSeed':'1'},
    children:graph.nodes.map(n=>({id:index.get(n.id),...size})),
    edges:graph.edges.map((e,i)=>({id:'e'+i,sources:[index.get(e.from)],targets:[index.get(e.to)],
      ...(e.label?{labels:[{text:e.label,width:Math.min(210,e.label.length*12+8),height:18}]}:{})}))
  };
  let output;
  try { output=await elk.layout(model); }
  catch(error){throw new GraphError('LAYOUT_FAILED','自动排版失败：'+error.message);}
  const positions=new Map(output.children.map(n=>[n.id,{x:Math.round(n.x),y:Math.round(n.y)}]));
  const routes=new Map(output.edges?.map(e=>[e.id,e.sections?.[0]]));
  return normalize({...graph,nodes:graph.nodes.map(n=>({...n,position:positions.get(index.get(n.id))})),
    edges:graph.edges.map(({points,...e},i)=>{
      const section=routes.get('e'+i);
      return section?{...e,points:[section.startPoint,...(section.bendPoints||[]),section.endPoint]}:e;
    })});
}

function edit(input, operations) {
  const graph=normalize(input);
  if(!Array.isArray(operations)||operations.length<1||operations.length>2000)throw new GraphError('INVALID_PATCH','补丁需要 1 至 2000 项操作。');
  const nodes=new Map(graph.nodes.map(n=>[n.id,n])), edges=new Map(graph.edges.map(e=>[e.id,e]));
  const invalidate=new Set();
  for(const op of operations){
    if(!object(op))throw new GraphError('INVALID_PATCH','操作须为对象。');
    switch(op.op){
      case 'set-title': graph.title=op.value;break;
      case 'put-node': {
        const n=op.node;
        if(!object(n)||!idOf(n.id))throw new GraphError('INVALID_PATCH','put-node 需要 node.id。');
        const before=nodes.get(n.id);
        if(JSON.stringify(before?.position)!==JSON.stringify(n.position))invalidate.add(n.id);
        nodes.set(n.id,{...n,...(before&&n.duration!==before.duration?{estimated:false}:{})}); break;
      }
      case 'put-edge':
        if(!object(op.edge)||!idOf(op.edge.id))throw new GraphError('INVALID_PATCH','put-edge 需要 edge.id。');
        edges.set(op.edge.id,{...op.edge,points:undefined}); break;
      case 'remove-node':
        if(!nodes.delete(op.id))throw new GraphError('INVALID_PATCH','待删除的节点不存在。');
        for(const [id,e] of edges)if(e.from===op.id||e.to===op.id)edges.delete(id);
        break;
      case 'remove-edge':
        if(!edges.delete(op.id))throw new GraphError('INVALID_PATCH','待删除的连线不存在。');
        break;
      default: throw new GraphError('INVALID_PATCH','无法识别的操作 '+String(op.op)+ '。');
    }
  }
  graph.nodes=[...nodes.values()];
  graph.edges=[...edges.values()].map(e=>invalidate.has(e.from)||invalidate.has(e.to)?{...e,points:undefined}:e);
  return normalize(graph);
}

function manualRoute(a,b,same,index) {
  const x=a.position.x,y=a.position.y,tx=b.position.x,ty=b.position.y;
  if(same){const k=22+index*8;return [{x:x+size.width,y:y+22},{x:x+size.width+k,y:y+22},{x:x+size.width+k,y:y-k},{x:x+90,y:y-k},{x:x+90,y}];}
  const horizontal=Math.abs(tx-x)>=Math.abs(ty-y);
  const ax=horizontal?(tx>=x?x+size.width:x):x+size.width/2;
  const bx=horizontal?(tx>=x?tx:tx+size.width):tx+size.width/2;
  const ay=horizontal?y+size.height/2:(ty>=y?y+size.height:y);
  const by=horizontal?ty+size.height/2:(ty>=y?ty:ty+size.height);
  const mid=horizontal?(ax+bx)/2:(ay+by)/2;
  return horizontal?[{x:ax,y:ay},{x:mid,y:ay},{x:mid,y:by},{x:bx,y:by}]:
    [{x:ax,y:ay},{x:ax,y:mid},{x:bx,y:mid},{x:bx,y:by}];
}
const xml=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[ch]);
function short(value,n){const chars=[...value.replace(/\s+/g,' ')];return chars.length<=n?chars.join(''):chars.slice(0,n-1).join('')+'…';}

async function render(input,{critical=false,forceLayout=false}={}) {
  let graph=normalize(input);
  if(forceLayout||graph.nodes.some(n=>!n.position))graph=await layout(graph);
  const result=critical?cpm(graph):null;
  const criticalNodes=new Set(result?.nodes.filter(n=>n.tf===0).map(n=>n.id));
  const criticalEdges=new Set(result?.criticalEdges);
  const lookup=new Map(graph.nodes.map(n=>[n.id,n]));
  const routes=graph.edges.map((e,i)=>e.points||manualRoute(lookup.get(e.from),lookup.get(e.to),e.from===e.to,i%5));
  let minX=0,minY=0,maxX=0,maxY=0;
  function include(x,y){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  for(const {position:{x,y}} of graph.nodes){include(x,y);include(x+size.width,y+size.height);}
  for(const route of routes)for(const p of route)include(p.x,p.y);
  const left=minX-22,top=minY-22;
  const width=Math.max(230,maxX-left+22),height=Math.max(100,maxY-top+22);
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" role="img"><title>${xml(graph.title)}</title>`,
    '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#657e98"/></marker><marker id="arrow-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#bd4a45"/></marker></defs>',
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#fafcff"/>`];
  for(const [i,e] of graph.edges.entries()) {
    const route=routes[i],isCritical=criticalEdges.has(e.id);
    const color=isCritical?'#bd4a45':'#657e98';
    const d=route.map((p,j)=>(j?'L':'M')+p.x+','+p.y).join(' ');
    const middle=route[Math.floor(route.length/2)-1],next=route[Math.floor(route.length/2)];
    const x=(middle.x+next.x)/2,y=(middle.y+next.y)/2;
    const label=short([e.label,e.lag?'+'+e.lag+' 天':''].filter(Boolean).join(' · '),18);
    parts.push(`<g data-edge="${xml(e.id)}" style="cursor:pointer"><title>${xml(e.from+' → '+e.to+' '+e.label)}</title><path d="${d}" stroke="transparent" stroke-width="13" fill="none"/><path d="${d}" stroke="${color}" stroke-width="1.7" fill="none" marker-end="url(#${isCritical?'arrow-red':'arrow'})"/>${label?`<text x="${x}" y="${y-6}" text-anchor="middle" stroke="#fafcff" stroke-width="5" paint-order="stroke" fill="#435972" font-size="11">${xml(label)}</text>`:''}</g>`);
  }
  for(const n of graph.nodes) {
    const {x,y}=n.position;
    const color=criticalNodes.has(n.id)?'#bd4a45':{task:'#2f72ae',milestone:'#247a66',decision:'#a36a29'}[n.kind];
    const fill=criticalNodes.has(n.id)?'#fff0ed':{task:'#eff7ff',milestone:'#e9fbf2',decision:'#fff6e6'}[n.kind];
    parts.push(`<g data-node="${xml(n.id)}" transform="translate(${x} ${y})" style="cursor:pointer"><title>${xml(n.label)}</title><rect class="node-shell" width="${size.width}" height="${size.height}" rx="${n.kind==='milestone'?26:10}" fill="${fill}" stroke="${color}" stroke-width="1.5"/><path d="M12 18 L17 13 L22 18 L17 23 Z" fill="${color}"/><text x="30" y="22" fill="#16334f" font-size="13" font-weight="700">${xml(short(n.label,10))}</text><text x="14" y="43" fill="#566b81" font-size="11">${xml(short(n.id,16))}${n.duration===undefined?'':' · '+n.duration+' 天'}</text></g>`);
  }
  parts.push('</svg>');
  const svg=parts.join('\n').replace('role="img"','role="img" font-family="Microsoft YaHei UI, Segoe UI, sans-serif"');
  return {graph,svg,analysis:result};
}

module.exports={GraphError,normalize,layout,render,cpm,edit};
