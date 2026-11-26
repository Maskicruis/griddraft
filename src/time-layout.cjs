'use strict';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const measure=text=>[...text].reduce((sum,char)=>sum+(char.charCodeAt(0)>255?13:7.2),0);
function wrap(text,width){
  const lines=[];let line='';
  for(const char of text){if(line&&measure(line+char)>width){lines.push(line);line='';}line+=char;}
  if(line)lines.push(line);return lines;
}
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function candidate(network,scale,viewport){
  const margin=160,width=Math.ceil(Math.max(viewport.width,network.duration*scale+2*margin));
  const eventById=new Map(network.events.map(event=>[event.id,event]));
  const routes=new Map(),preferred=new Map(),ranges=[];
  const sorted=network.arrows.slice().sort((a,b)=>Number(b.critical)-Number(a.critical)||a.earlyStart-b.earlyStart||a.from-b.from||a.to-b.to);
  for(const arrow of sorted){
    const a=eventById.get(arrow.from).early*scale,b=eventById.get(arrow.to).early*scale;
    const fits=row=>!(ranges[row]??[]).some(([left,right])=>left<Math.max(a+2,b)&&right>a);
    let lane=preferred.get(arrow.from)??0;
    if(!fits(lane)){lane=0;while(!fits(lane))lane++;}
    (ranges[lane]??=[]).push([a,Math.max(a+2,b)]);routes.set(arrow.id,lane);
    if(!preferred.has(arrow.from))preferred.set(arrow.from,lane);
    if(!preferred.has(arrow.to))preferred.set(arrow.to,lane);
  }
  const positions=new Map(),occupied=[];
  for(const event of network.events){
    const x=margin+event.early*scale,prefer=preferred.get(event.id)??0;
    let lane=prefer;
    const fits=row=>!(occupied[row]??[]).some(other=>Math.abs(x-other)<38);
    if(!fits(lane)){
      const candidates=Array.from({length:network.events.length+ranges.length+1},(_,i)=>i).sort((a,b)=>Math.abs(a-prefer)-Math.abs(b-prefer)||a-b);
      lane=candidates.find(fits);
    }
    (occupied[lane]??=[]).push(x);positions.set(event.id,{x,lane});
  }
  const labels=new Map(),bands=[];
  for(const arrow of sorted){
    if(!arrow.activityId&&arrow.kind!=='lag')continue;
    const text=arrow.activityId?arrow.label+' · '+arrow.duration+'天':arrow.label;
    const lines=wrap(text,230),boxWidth=Math.max(70,...lines.map(measure))+12,height=lines.length*18+8;
    const mid=margin+(arrow.earlyStart+arrow.duration/2)*scale;
    const x=clamp(mid,boxWidth/2+14,width-boxWidth/2-14),left=x-boxWidth/2;
    const lane=routes.get(arrow.id),rows=bands[lane]??=[];
    let band=rows.findIndex(row=>row.ranges.every(([a,b])=>b+16<=left||a>=left+boxWidth+16));
    if(band<0){band=rows.length;rows.push({height:0,ranges:[]});}
    rows[band].height=Math.max(rows[band].height,height);rows[band].ranges.push([left,left+boxWidth]);
    labels.set(arrow.id,{x,left,width:boxWidth,height,lines,lane,band});
  }
  const count=1+Math.max(0,...routes.values(),...[...positions.values()].map(p=>p.lane));
  const baseline=[],tops=[];let cursor=116;
  for(let lane=0;lane<count;lane++){
    const rows=bands[lane]??[];tops[lane]=[];
    for(const row of rows){tops[lane].push(cursor);cursor+=row.height+7;}
    baseline[lane]=cursor+26;cursor+=66;
  }
  for(const item of labels.values())item.top=tops[item.lane][item.band];
  for(const p of positions.values())p.y=baseline[p.lane];
  const height=Math.ceil(Math.max(350,cursor+38));
  const target=clamp(viewport.width/viewport.height,1.35,2.4);
  const score=Math.abs(Math.log((width/height)/target))+.12*Math.log(width*height/1e6)+.035*Math.max(0,...Array.from(bands,rows=>rows?.length??0));
  return {width,height,scale,margin,locations:positions,routeY:new Map([...routes].map(([id,lane])=>[id,baseline[lane]])),labels,score};
}

function timeGeometry(network,{pixelsPerDay,viewport={width:1200,height:720}}={}){
  viewport={width:clamp(Number(viewport?.width)||1200,650,2200),height:clamp(Number(viewport?.height)||720,400,1400)};
  if(pixelsPerDay)return candidate(network,Math.min(pixelsPerDay,150000/Math.max(1,network.duration)),viewport);
  const widths=[viewport.width*1.05,viewport.width*1.5,2200,3200,4800,7200];
  const candidates=widths.map(width=>candidate(network,clamp((width-320)/Math.max(1,network.duration),.001,120),viewport));
  return candidates.sort((a,b)=>a.score-b.score)[0];
}

const motionStyle='<style>@keyframes grid-flow{to{stroke-dashoffset:-32}}.network-flow{animation:grid-flow 1.8s linear infinite;pointer-events:none;stroke-linecap:round;fill:none;stroke-dasharray:4 28;stroke-width:3.6;opacity:.8}@media(prefers-reduced-motion:reduce){.network-flow{animation:none;display:none}}</style>';
function renderTimeNetwork(network,options={}){
  const geometry=timeGeometry(network,options),{width,height,scale,locations,routeY,labels,margin}=geometry;
  const animated=options.animated===true;
  const titleLines=wrap(network.title,Math.max(400,(width-44)*.6));
  const lines=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-layout="adaptive-time" data-pixels-per-day="${scale}" role="img" font-family="Microsoft YaHei UI, Segoe UI, sans-serif"><title>${escape(network.title)} — 双代号时标网络图</title>`,
    `<rect width="${width}" height="${height}" fill="#fbfdff"/>`,animated&&options.embedMotionStyle!==false?motionStyle:'',
    `<text x="22" y="34" font-size="21" font-weight="700" fill="#15314a">${escape(titleLines[0]+(titleLines.length>1?'…':''))}</text>`,
    `<text x="22" y="62" font-size="13" fill="#516a82">双代号时标网络图 · 等比例时间轴 · ${network.estimatedCount?'占位工期计算':'计算工期'} ${network.duration} 天${network.estimatedCount?' · '+network.estimatedCount+' 道工期待估算':''}</text>`];
  const minimum=Math.max(1,Math.ceil(80/scale),Math.ceil(network.duration/60));
  const magnitude=10**Math.floor(Math.log10(minimum));
  const tick=[1,2,5,10].map(n=>n*magnitude).find(n=>n>=minimum);
  const ticks=Array.from({length:Math.floor(network.duration/tick)+1},(_,i)=>i*tick);
  if(ticks.at(-1)!==network.duration){if(network.duration-ticks.at(-1)<tick/2&&ticks.length>1)ticks.pop();ticks.push(network.duration);}
  for(const day of ticks){const x=margin+day*scale;lines.push(`<path d="M${x} 99 V${height-38}" stroke="#e7edf4"/><text x="${x}" y="90" font-size="12" text-anchor="middle" fill="#526b84">D${day}</text>`);}
  function path(d,color,dashed=false){return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${dashed?' stroke-dasharray="5 4"':''}/>`;}
  const deferredLabels=[];
  for(const arrow of network.arrows){
    const from=locations.get(arrow.from),to=locations.get(arrow.to),y=routeY.get(arrow.id),endWork=margin+(arrow.earlyStart+arrow.duration)*scale;
    const color=arrow.kind==='lag'?'#a36416':arrow.critical?'#b94440':arrow.kind==='dummy'?'#7a8fa4':'#277da5';
    const hit=`M${from.x} ${from.y} V${y} H${to.x} V${to.y}`;
    let content=`<path d="${hit}" fill="none" stroke="transparent" stroke-width="16" pointer-events="stroke"/>`;
    content+=path(`M${from.x} ${from.y} V${y} H${endWork}`,color,arrow.kind==='dummy');
    const gap=to.x-endWork;
    if(gap>.08){
      const waves=Math.max(1,Math.min(400,Math.ceil(gap/10)));let wave=`M${endWork} ${y}`;
      for(let i=1;i<=waves;i++)wave+=` Q${endWork+gap*(i-.5)/waves} ${y+(i%2?4:-4)} ${endWork+gap*i/waves} ${y}`;
      content+=path(wave,color);
    }
    content+=path(`M${to.x} ${y} V${to.y}`,color,arrow.kind==='dummy');
    if(animated)content+=`<path d="${hit}" class="network-flow" stroke="${color}"/>`;
    if(Math.abs(y-to.y)>1){const dir=Math.sign(to.y-y),tip=to.y-dir*14;content+=`<path d="M${to.x} ${tip} l-4 ${-dir*7} h8 Z" fill="${color}"/>`;}
    else content+=`<path d="M${to.x-14} ${y} l-7 -4 v8 Z" fill="${color}"/>`;
    lines.push(`<g data-activity="${escape(arrow.activityId??'')}" data-kind="${arrow.kind}" data-critical="${arrow.critical}"><title>${escape((arrow.activityId??'')+' '+arrow.label)}｜${arrow.from}→${arrow.to}｜ES D${arrow.earlyStart} EF D${arrow.earlyFinish}｜TF ${arrow.totalFloat} FF ${arrow.freeFloat}</title>${content}</g>`);
    const box=labels.get(arrow.id);
    if(box)deferredLabels.push(`<g data-activity="${escape(arrow.activityId??'')}" data-label-for="${escape(arrow.id)}"><title>${escape((arrow.activityId??'')+' '+arrow.label)}</title><rect x="${box.left-3}" y="${box.top}" width="${box.width+6}" height="${box.height}" rx="4" fill="#fbfdff" fill-opacity=".96"/>`+
      box.lines.map((line,index)=>`<text x="${box.x}" y="${box.top+17+index*18}" text-anchor="middle" font-size="13" font-weight="600" fill="${color}">${escape(line)}</text>`).join('')+'</g>');
  }
  lines.push(...deferredLabels);
  for(const event of network.events){
    const p=locations.get(event.id),boundary=event.id===network.start||event.id===network.finish;
    lines.push(`<g data-event="${event.id}"><title>事件 ${event.id}｜最早 D${event.early}｜最迟 D${event.late}${event.milestones.length?'｜'+escape(event.milestones.map(row=>row.label).join(' / ')):''}</title><circle cx="${p.x}" cy="${p.y}" r="13" fill="${boundary?'#234f77':'#fbfdff'}" stroke="#316b97" stroke-width="1.8"/><text x="${p.x}" y="${p.y+4}" text-anchor="middle" font-size="12" font-weight="700" fill="${boundary?'#fff':'#316b97'}">${event.id}</text>${boundary?`<text x="${p.x}" y="${p.y+31}" text-anchor="middle" font-size="12" fill="#316b97">${event.id===network.start?'开始':'完成'}</text>`:''}</g>`);
  }
  lines.push(`<text x="22" y="${height-13}" font-size="12" fill="#516a82">红线 关键工作 · 虚线 虚工作 · 橙线 时滞 · 波形 等待 · 名称自动换行与避让${animated?' · 流动动画仅表达依赖方向':''}</text></svg>`);
  return lines.join('\n');
}
module.exports={timeGeometry,renderTimeNetwork,motionStyle};
