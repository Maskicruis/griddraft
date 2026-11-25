'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {generateProject}=require('../src/project.cjs');
const {buildSummary,renderSummary}=require('../src/summary.cjs');
const {cpm,edit}=require('../src/engine.cjs');

function project(count=27){
  return generateProject({version:1,name:'重复模块验证',foundation:'pile',lineMethod:'cable',
    units:[{type:'wind',count},{type:'substation',count:1},{type:'collector',count:3},{type:'road',count:1}]}).graph;
}

test('repeated units collapse without mutating source data or losing schedule and external energization gates',()=>{
  const graph=project(),snapshot=JSON.stringify(graph),summary=buildSummary(graph);
  assert.equal(JSON.stringify(graph),snapshot);
  assert.equal(summary.duration,cpm(graph).duration);
  assert.equal(summary.groups.find(group=>group.type==='wind').units.length,27);
  assert.equal(summary.groups.find(group=>group.type==='wind').stages.length,2);
  assert.ok(summary.nodes.length<graph.nodes.length/10);
  const gate=summary.nodes.find(node=>node.sourceIds.includes('PROJECT.ENERGIZE'));
  const pre=summary.nodes.find(node=>node.sourceIds.includes('WT01.cold'));
  const post=summary.nodes.find(node=>node.sourceIds.includes('WT01.grid'));
  assert.notEqual(pre.id,post.id);
  assert.ok(summary.edges.some(edge=>edge.from===pre.id&&edge.to===gate.id));
  assert.ok(summary.edges.some(edge=>edge.from===gate.id&&edge.to===post.id));
  assert.deepEqual(new Set(summary.nodes.flatMap(node=>node.sourceIds)),new Set(graph.nodes.map(node=>node.id)));
  const shown=new Set(summary.edges.flatMap(edge=>edge.sourceIds));
  const owner=new Map(summary.nodes.flatMap(node=>node.sourceIds.map(id=>[id,node.id])));
  assert.ok(graph.edges.every(edge=>shown.has(edge.id)||owner.get(edge.from)===owner.get(edge.to)));
});

test('duration, dependency, naming, provenance and external boundary differences prevent false grouping',()=>{
  const initial=project(3),selected=initial.nodes.find(node=>node.id==='WT01.cure');
  const variants=[
    edit(initial,[{op:'put-node',node:{...selected,duration:14}}]),
    edit(initial,[{op:'put-node',node:{...selected,label:'特殊养护'}}]),
    edit(initial,[{op:'put-node',node:{...selected,estimated:false}}]),
    edit(initial,[{op:'put-edge',edge:{id:'extra',from:'WT01.excavate',to:'WT01.pour',lag:2}}]),
    edit(initial,[{op:'put-edge',edge:{id:'external',from:'SS01.civil',to:'WT01.excavate',lag:1}}])
  ];
  for(const graph of variants){
    const groups=buildSummary(graph).groups.filter(group=>group.type==='wind');
    assert.equal(groups.length,2);
    assert.deepEqual(groups.find(group=>group.units.includes('WT01')).units,['WT01']);
    assert.deepEqual(groups.find(group=>group.units.includes('WT02')).units,['WT02','WT03']);
  }
  const moved=edit(initial,[{op:'put-node',node:{...selected,position:{x:40,y:80}}}]);
  assert.equal(buildSummary(moved).groups.filter(group=>group.type==='wind').length,1);
});

test('summary export contains drill-down targets and CLI JSON preserves instance mapping',async()=>{
  const graph=project(2),summary=buildSummary(graph),svg=await renderSummary(summary);
  assert.match(svg,/data-module="S\d+" data-unit="WT01"/);
  assert.match(svg,/tabindex="0"/);
  assert.match(svg,/源网络占位工期/);
  const result=spawnSync(process.execPath,['bin/griddraft.cjs','summary','-','--format','json'],{input:JSON.stringify(graph),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout);
  assert.equal(data.kind,'module-summary');
  assert.deepEqual(data.groups.find(group=>group.type==='wind').units,['WT01','WT02']);
});
