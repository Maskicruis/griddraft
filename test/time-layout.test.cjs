'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildNetwork,renderNetwork}=require('../src/aoa.cjs');
const {timeGeometry}=require('../src/time-layout.cjs');
function scenario(){
  const nodes=[],edges=[];
  for(let unit=0;unit<12;unit++)for(let step=0;step<5;step++){
    const id='T'+unit+'-'+step;
    nodes.push({id,label:'第'+unit+'分区综合楼基础混凝土浇筑养护及质量验收工序'+step,duration:step===0?120:step===1?1:20});
    if(step)edges.push({id:'E'+id,from:'T'+unit+'-'+(step-1),to:id});
  }
  return {version:1,title:'长周期与密集工序',nodes,edges};
}
test('adaptive time layout preserves proportional clock and separates every label and nearby event',()=>{
  const graph=scenario(),network=buildNetwork(graph),before=JSON.stringify(network);
  const layout=timeGeometry(network,{viewport:{width:1000,height:650}});
  assert.equal(JSON.stringify(network),before);
  assert.ok(Number.isFinite(layout.score));
  assert.ok(layout.width/layout.height<6);
  const labels=[...layout.labels.values()];
  assert.equal(labels.length,network.arrows.filter(row=>row.activityId||row.kind==='lag').length);
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    const a=labels[i],b=labels[j];
    assert.ok(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top,'Label boxes overlap');
  }
  for(const event of network.events){
    const p=layout.locations.get(event.id);
    assert.ok(Math.abs(p.x-layout.margin-event.early*layout.scale)<1e-6);
  }
  const points=[...layout.locations.values()];
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)if(points[i].y===points[j].y)assert.ok(Math.abs(points[i].x-points[j].x)>=38);
  const svg=renderNetwork(network);
  assert.equal((svg.match(/data-label-for=/g)||[]).length,labels.length);
  assert.doesNotMatch(svg,/network-flow/);
  assert.match(renderNetwork(network,{animated:true}),/prefers-reduced-motion/);
});
test('manual scale remains uniform and animation does not change time or geometry',()=>{
  const network=buildNetwork(require('../examples/fuyu-demo.json'));
  assert.equal(timeGeometry(network,{pixelsPerDay:20}).scale,20);
  const still=renderNetwork(network),animated=renderNetwork(network,{animated:true});
  assert.equal(still.match(/viewBox="([^"]+)"/)[1],animated.match(/viewBox="([^"]+)"/)[1]);
  assert.match(renderNetwork(network,{view:'logic',animated:true}),/grid-flow/);
  assert.throws(()=>renderNetwork(network,{pixelsPerDay:0}),/像素/);
});
