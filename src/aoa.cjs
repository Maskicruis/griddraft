'use strict';

const { normalize, cpm, GraphError } = require('./engine.cjs');

function ordered(events, arrows, rank) {
  const next = new Map(events.map(id => [id, []]));
  const incoming = new Map(events.map(id => [id, 0]));
  for (const edge of arrows) {
    next.get(edge.from).push(edge);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  }
  const queue = events.filter(id => incoming.get(id) === 0);
  const result = [];
  while (queue.length) {
    if (rank) queue.sort((a,b) => rank(a)-rank(b));
    const id = queue.shift();
    result.push(id);
    for (const edge of next.get(id)) {
      const left = incoming.get(edge.to) - 1;
      incoming.set(edge.to, left);
      if (!left) queue.push(edge.to);
    }
  }
  if (result.length !== events.length) throw new GraphError('CYCLE', '网络中存在循环。');
  return { result, next };
}

function buildNetwork(input) {
  const graph = normalize(input);
  if (!graph.nodes.length) throw new GraphError('EMPTY_NETWORK', '至少添加一道工作后才能生成双代号网络。');
  const calculated = cpm(graph);
  const byId = new Map(graph.nodes.map(n => [n.id,n]));
  const incoming = new Map(graph.nodes.map(n => [n.id,new Map()]));
  for (const e of graph.edges) {
    const targets = incoming.get(e.to);
    targets.set(e.from, Math.max(targets.get(e.from) ?? 0, e.lag));
  }
  const { result: tasks, next: successors } = ordered([...byId.keys()],graph.edges);
  const events = [0], markers = new Map(), arrows = [];
  const starts = new Map(), ends = new Map(), junctions = new Map();
  const createEvent = () => { events.push(events.length); return events.at(-1); };
  const add = (from,to,duration,kind,label,activityId) => arrows.push({ from,to,duration,kind,label,activityId });
  for (const id of tasks) {
    const task = byId.get(id);
    const constraints = new Map();
    for (const [predecessor, lag] of incoming.get(id)) {
      const event = ends.get(predecessor);
      constraints.set(event, Math.max(constraints.get(event) ?? 0,lag));
    }
    const links = [...constraints].sort((a,b) => a[0]-b[0]);
    let start = 0;
    if (links.length === 1 && links[0][1] === 0) start = links[0][0];
    else if (links.length) {
      const key = JSON.stringify(links);
      if (junctions.has(key)) start = junctions.get(key);
      else {
        start = createEvent();
        junctions.set(key,start);
        for (const [event,lag] of links) add(event,start,lag,lag?'lag':'dummy',lag?'等待 '+lag+' 天':'虚工作');
      }
    }
    starts.set(id,start);
    if (task.kind === 'milestone') {
      ends.set(id,start);
      if (!markers.has(start)) markers.set(start,[]);
      markers.get(start).push({ id, label: task.label });
    } else {
      const end = createEvent();
      ends.set(id,end);
      add(start,end,task.duration,'activity',task.label,id);
    }
  }

  // Merge a terminal activity into the project end when its arrow pair is unique.
  // Parallel terminal activities with the same starting event keep separate end events.
  const sinks = [...new Set(tasks.filter(id => !successors.get(id).length).map(id => ends.get(id)))];
  let finish;
  if (sinks.length === 1) finish = sinks[0];
  else {
    finish = createEvent();
    const useFrom = new Set();
    for (const sink of sinks) {
      const sameEventStillUsed = arrows.some(e => e.from===sink);
      const edge = arrows.find(e => e.to===sink && e.kind==='activity');
      if (!sameEventStillUsed && edge && !markers.has(sink) && !useFrom.has(edge.from)) {
        edge.to = finish;
        useFrom.add(edge.from);
        events.splice(events.indexOf(sink),1);
        ends.set(edge.activityId,finish);
      } else if (!arrows.some(e=>e.from===sink&&e.to===finish)) {
        add(sink,finish,0,'dummy','虚工作');
        useFrom.add(sink);
      }
    }
  }
  const { result: topology, next } = ordered(events,arrows);
  const es = new Map(events.map(id=>[id,0])), ls = new Map(), layer = new Map(events.map(id=>[id,0]));
  for (const event of topology) for (const e of next.get(event)) {
    es.set(e.to,Math.max(es.get(e.to),es.get(event)+e.duration));
    layer.set(e.to,Math.max(layer.get(e.to),layer.get(event)+1));
  }
  const total = es.get(finish);
  for (const event of topology.slice().reverse()) {
    const leaves = next.get(event);
    ls.set(event,leaves.length?Math.min(...leaves.map(e=>ls.get(e.to)-e.duration)):total);
  }
  const timetable = new Map(calculated.nodes.map(n=>[n.id,n]));
  const numbered = ordered(events,arrows,id=>es.get(id)).result;
  const number = new Map(numbered.map((id,i)=>[id,i+1]));
  if (total!==calculated.duration) throw new GraphError('NETWORK_MISMATCH','转换后的工期与源图不一致。');
  const uniquePairs = new Set();
  const outputArrows = arrows.map((arrow,i)=>{
    const {from,to,duration,kind,activityId,label} = arrow;
    const pair = number.get(from)+'-'+number.get(to);
    if(uniquePairs.has(pair))throw new GraphError('NETWORK_MISMATCH','存在重复双代号 '+pair+'。');
    uniquePairs.add(pair);
    const earlyStart=es.get(from),earlyFinish=earlyStart+duration;
    const totalFloat=ls.get(to)-earlyFinish;
    const expected=timetable.get(activityId);
    if(expected&&(expected.es!==earlyStart||expected.ef!==earlyFinish||expected.tf!==totalFloat))
      throw new GraphError('NETWORK_MISMATCH','工作 '+activityId+' 的时间参数在转换后不一致。');
    return { id:'A'+(i+1),from:number.get(from),to:number.get(to),kind,label,duration,
      ...(activityId?{activityId}:{}),earlyStart,earlyFinish,totalFloat,
      freeFloat:expected?.ff ?? es.get(to)-earlyFinish,gapAtHead:es.get(to)-earlyFinish,
      critical:totalFloat===0 };
  });
  for (const [id, event] of starts) {
    if (byId.get(id).kind==='milestone' && timetable.get(id).es!==es.get(event))
      throw new GraphError('NETWORK_MISMATCH','里程碑 '+id+' 的时间参数在转换后不一致。');
  }
  return {version:1,kind:'activity-on-arrow',title:graph.title,duration:total,start:number.get(0),finish:number.get(finish),
    ...(graph.nodes.some(node=>node.estimated)?{estimatedCount:graph.nodes.filter(node=>node.estimated).length}:{}),
    events:numbered.map(id=>({id:number.get(id),early:es.get(id),late:ls.get(id),layer:layer.get(id),milestones:markers.get(id)||[]})),
    arrows:outputArrows};
}

const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);

function lanes(network,view) {
  const time = e => view==='time'?e.early:e.layer;
  const events = new Map(network.events.map(e=>[e.id,e]));
  const ranges = [], routeLanes = new Map(), preferred = new Map();
  const byStart = network.arrows.slice().sort((a,b)=>Number(b.critical)-Number(a.critical)||
    time(events.get(a.from))-time(events.get(b.from))||a.from-b.from||a.to-b.to);
  for (const arrow of byStart) {
    const a=time(events.get(arrow.from)),b=time(events.get(arrow.to));
    const prefer=preferred.get(arrow.from) ?? 0;
    let lane=prefer;
    if (a!==b) {
      const fits=row => !(ranges[row]||[]).some(([x,y])=>x<b&&y>a);
      if(!fits(lane)){lane=0;while(!fits(lane))lane++;}
      (ranges[lane] ||= []).push([a,b]);
    }
    routeLanes.set(arrow.id,lane);
    if (!preferred.has(arrow.from)) preferred.set(arrow.from,lane);
    if (!preferred.has(arrow.to)) preferred.set(arrow.to,lane);
  }
  const avoid = new Map(), positions = new Map();
  for (const e of network.events) {
    const bucket=avoid.get(time(e)) || new Set();
    let i=preferred.get(e.id) || 0;
    if(bucket.has(i)){
      const nearest=Array.from({length:Math.max(12,network.events.length)},(_,n)=>n)
        .filter(n=>!bucket.has(n)).sort((a,b)=>Math.abs(a-i)-Math.abs(b-i));
      i=nearest[0];
    }
    bucket.add(i);
    avoid.set(time(e),bucket);
    positions.set(e.id,i);
  }
  return {time,routeLanes,positions};
}

function renderNetwork(network,{view='time',pixelsPerDay=32}={}) {
  if (!['time','logic'].includes(view)) throw new GraphError('INVALID_VIEW','视图须为 time 或 logic。');
  if (!Number.isInteger(pixelsPerDay)||pixelsPerDay<4||pixelsPerDay>120)
    throw new GraphError('INVALID_SCALE','每日报表像素须为 4 至 120 的整数。');
  const {time,routeLanes,positions}=lanes(network,view);
  const x0=65, y0=163, pitch=86;
  const unit=view==='time'?Math.min(pixelsPerDay, Math.max(0.001,150000/Math.max(1,network.duration))):180;
  const axis=Math.max(...network.events.map(time));
  const width=Math.max(820,Math.ceil(x0+axis*unit+65));
  const height=Math.max(335,y0+(1+Math.max(0,...positions.values(),...routeLanes.values()))*pitch+85);
  const location=new Map(network.events.map(e=>[e.id,{x:x0+time(e)*unit,y:y0+positions.get(e.id)*pitch}]));
  const lines=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="Microsoft YaHei UI, Segoe UI, sans-serif">`,
    `<title>${escape(network.title)} — ${view==='time'?'双代号时标网络图':'双代号网络图'}</title>`,
    `<rect width="${width}" height="${height}" fill="#fbfdff"/>`,
    `<text x="22" y="35" font-size="22" font-weight="700" fill="#15314a">${escape(network.title)}</text>`,
    `<text x="22" y="63" font-size="13" fill="#516a82">${view==='time'?'双代号时标网络图 · 最早时间标尺':'双代号网络图 · 逻辑结构'} · ${network.estimatedCount?'占位工期计算':'计算工期'} ${network.duration} 天${network.estimatedCount?' · '+network.estimatedCount+' 道工期待估算':''}</text>`];
  const tick=Math.max(1,Math.ceil(Math.max(58/unit,axis/45)));
  if(view==='time'){
    const ticks=Array.from({length:Math.floor(axis/tick)+1},(_,i)=>i*tick);
    if(ticks.at(-1)!==axis){if(axis-ticks.at(-1)<tick/2&&ticks.length>1)ticks.pop();ticks.push(axis);}
    for(const day of ticks){
      const x=x0+day*unit;
      lines.push(`<path d="M${x} 94 V${height-56}" stroke="#e5edf4"/><text x="${x}" y="89" text-anchor="middle" font-size="12" fill="#526b84">D${day}</text>`);
    }
  }
  function path(d,color,{dashed=false,heavy=false}={}){
    if(!d)return '';
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${heavy?3:2}"${dashed?' stroke-dasharray="5 4"':''}/>`;
  }
  const usedLabels=new Map();
  for(const arrow of network.arrows){
    const from=location.get(arrow.from), to=location.get(arrow.to);
    const y=y0+routeLanes.get(arrow.id)*pitch;
    const color=arrow.kind==='lag'?'#a36416':arrow.critical?'#b94440':arrow.kind==='dummy'?'#788da2':'#346b96';
    const critical=arrow.critical;
    const label=arrow.activityId?arrow.activityId+' '+arrow.label+' · '+arrow.duration+'天':arrow.kind==='lag'?arrow.label:'';
    const gap=view==='time'?arrow.gapAtHead*unit:0;
    const dash=arrow.kind==='dummy';
    const endWork=to.x-gap;
    let content='';
    const hitPath = from.x===to.x
      ? `M${from.x} ${from.y} V${to.y}`
      : `M${from.x} ${from.y} V${y} H${to.x} V${to.y}`;
    if (arrow.activityId) content+=`<path d="${hitPath}" fill="none" stroke="transparent" stroke-width="16" pointer-events="stroke"/>`;
    if(from.x===to.x){
      content+=path(`M${from.x} ${from.y} V${to.y}`,color,{dashed:dash,heavy:critical});
    }else{
      content+=path(`M${from.x} ${from.y} V${y} H${endWork}`,color,{dashed:dash,heavy:critical});
      if(gap>0.08){
        const waves=Math.max(1,Math.min(400,Math.ceil(gap/9)));
        let wave=`M${endWork} ${y}`;
        for(let i=1;i<=waves;i++)wave+=` Q${endWork+gap*(i-.5)/waves} ${y+(i%2?5:-5)} ${endWork+gap*i/waves} ${y}`;
        content+=path(wave,color,{heavy:critical});
      }
      content+=path(`M${to.x} ${y} V${to.y}`,color,{dashed:dash,heavy:critical});
    }
    const tailY=from.x===to.x?from.y:y;
    if(tailY!==to.y){
      const dir=Math.sign(to.y-tailY),tip=to.y-dir*14;
      content+=`<path d="M${to.x} ${tip} l-4 ${-dir*7} h8 Z" fill="${color}"/>`;
    }else{
      const tip=to.x-14;
      content+=`<path d="M${tip} ${y} l-7 -4 v8 Z" fill="${color}"/>`;
    }
    if(label){
      const shortName=[...arrow.label].slice(0,18).join('')+([...arrow.label].length>18?'…':'');
      const visible=arrow.activityId?shortName+' · '+arrow.duration+'天':label;
      const room=12+[...visible].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?14:8),0);
      const x=Math.max(room/2+8,Math.min(width-room/2-8,(from.x+endWork)/2));
      const bounds=[x-room/2,x+room/2];
      const placed=usedLabels.get(y)||[[],[],[]];
      const row=placed.findIndex(band=>band.every(([left,right])=>right<=bounds[0]||left>=bounds[1]));
      if(row!==-1){
        placed[row].push(bounds);
        usedLabels.set(y,placed);
        content+=`<text x="${x}" y="${y-12-row*17}" text-anchor="middle" font-size="13" font-weight="600" fill="${color}" stroke="#fbfdff" stroke-width="4" paint-order="stroke">${escape(visible)}</text>`;
      }
    }
    lines.push(`<g data-activity="${escape(arrow.activityId||'')}" data-kind="${arrow.kind}" data-critical="${critical}"><title>${escape(label||'虚工作')}｜${arrow.from}→${arrow.to}｜ES D${arrow.earlyStart} EF D${arrow.earlyFinish}｜TF ${arrow.totalFloat} FF ${arrow.freeFloat}</title>${content}</g>`);
  }
  for(const event of network.events){
    const p=location.get(event.id), boundary=event.id===network.start||event.id===network.finish;
    const color=boundary?'#234f77':'#316b97';
    const name=event.milestones.map(m=>m.label).join(' / ');
    const boundaryName = boundary ? `<text x="${p.x}" y="${p.y+31}" text-anchor="middle" font-size="12" fill="${color}">${event.id===network.start?'开始':'完成'}</text>` : '';
    lines.push(`<g data-event="${event.id}"><title>事件 ${event.id}｜最早 D${event.early}｜最迟 D${event.late}${name?'｜'+escape(name):''}</title><circle cx="${p.x}" cy="${p.y}" r="13" fill="${boundary?'#234f77':'#fbfdff'}" stroke="${color}" stroke-width="1.8"/><text x="${p.x}" y="${p.y+4}" text-anchor="middle" font-size="12" font-weight="700" fill="${boundary?'#fff':color}">${event.id}</text>${boundaryName}</g>`);
  }
  lines.push(`<text x="22" y="${height-22}" font-size="12" fill="#516a82">圆圈 事件编号　·　红线 关键线路　·　虚线 虚工作　·　橙线 时滞${view==='time'?'　·　波形 等待至箭头事件':''}</text></svg>`);
  return lines.join('\n');
}

module.exports={buildNetwork,renderNetwork};
