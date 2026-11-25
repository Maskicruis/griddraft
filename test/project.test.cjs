'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {parseProject,generateProject,templates,unitGraph}=require('../src/project.cjs');
const engine=require('../src/engine.cjs');
const {buildNetwork,renderNetwork}=require('../src/aoa.cjs');

test('text intake distinguishes project counts, circuit counts and length without inventing precise quantities',()=>{
  const brief=parseProject('项目名称：扶余一号\n27台风机，一座升压站，集电线路300公里，桩基施工。');
  assert.deepEqual(brief.units.map(unit=>[unit.type,unit.count]),[['wind',27],['substation',1],['collector',1]]);
  assert.equal(brief.units[2].aggregate,true);
  assert.equal(brief.units[2].lengthKm,300);
  assert.equal(brief.foundation,'pile');
  assert.ok(parseProject('数百台风机，1座升压站').units.every(unit=>unit.type!=='wind'));
  assert.ok(parseProject('27-30台风机，1座升压站').units.every(unit=>unit.type!=='wind'));
  assert.equal(parseProject('风机27台,升压站1座,3回集电线路').units.find(unit=>unit.type==='collector').count,3);
  assert.equal(parseProject('二十七台风机，升压站一座').units[0].count,27);
  assert.equal(parseProject('项目名称：测试,描述如下\n风机数量：27台\n升压站数量：1座').units[0].count,27);
});

test('CSV, pasted Excel TSV and project JSON share the same reusable project contract',()=>{
  const csv=parseProject('类型,数量,长度km\n"风机",2,\n升压站,1,\n集电线路,3,100');
  const tsv=parseProject('类型\t数量\t长度km\n风机\t2\t\n升压站\t1\t\n集电线路\t3\t100');
  assert.deepEqual(csv.units,tsv.units);
  const generated=generateProject(csv);
  const reopened=engine.normalize(JSON.parse(JSON.stringify(generated.graph)));
  assert.deepEqual(reopened,generated.graph);
  assert.deepEqual(parseProject(JSON.stringify(reopened.project)),reopened.project);
  assert.equal(reopened.nodes.find(node=>node.unit==='WT01').estimated,true);
  assert.throws(()=>parseProject('类型,数量\n"风机,2','csv'),/引号未闭合/);
  assert.throws(()=>parseProject('类型,数量\n风机,abc','csv'),/数量无效/);
  const parameters=parseProject('参数,值\n项目名称,Module Test\n风机数量,27\n升压站数量,1\n集电线路长度,300');
  assert.equal(parameters.name,'Module Test');
  assert.equal(parameters.units.find(unit=>unit.type==='collector').aggregate,true);
  const flat=parseProject('{"projectName":"Flat Test","turbineCount":27,"substationCount":1,"collectorLengthKm":300,"windCapacityMW":360}');
  assert.equal(flat.units.find(unit=>unit.type==='wind').count,27);
});

test('independent unit modules assemble into a valid AOA network with explicit energization gates',()=>{
  const brief={version:1,name:'模块组合验证',foundation:'pile',lineMethod:'overhead',
    units:[{type:'wind',count:27},{type:'substation',count:1},{type:'collector',count:3},{type:'road',count:2}]};
  const {graph,units,assumptions}=generateProject(brief);
  assert.equal(units.length,33);
  assert.equal(graph.nodes.filter(node=>node.id.endsWith('.pile')).length,27);
  assert.ok(graph.nodes.some(node=>node.id==='CL01.string'));
  assert.ok(graph.edges.some(edge=>edge.from==='RD01.handover'&&edge.to==='WT01.survey'));
  assert.ok(graph.edges.some(edge=>edge.from==='PROJECT.ENERGIZE'&&edge.to==='WT01.grid'));
  assert.ok(graph.edges.some(edge=>edge.from==='SS01.ready'&&edge.to==='PROJECT.ENERGIZE'));
  assert.ok(!graph.edges.some(edge=>edge.from.startsWith('WT01.')&&edge.to.startsWith('WT02.')));
  assert.match(assumptions.join(' '),/工期.*占位/);
  assert.equal(buildNetwork(graph).duration,engine.cpm(graph).duration);
  assert.match(renderNetwork(buildNetwork(graph)),/工期待估算/);
  const scoped=unitGraph(graph,'WT01');
  assert.ok(scoped.nodes.every(node=>node.unit==='WT01'));
  assert.ok(scoped.edges.every(edge=>edge.from.startsWith('WT01.')&&edge.to.startsWith('WT01.')));
  assert.equal(buildNetwork(scoped).arrows.filter(arrow=>arrow.kind==='activity').length,scoped.nodes.length);
});

test('module customization validates dependencies and manual duration edits preserve project provenance',()=>{
  const catalog=templates();
  catalog.wind.steps.find(step=>step.id==='cure').duration=14;
  catalog.wind.steps.find(step=>step.id==='cure').estimated=false;
  const brief={version:1,name:'修改模板',units:[{type:'wind',count:2}],templates:catalog};
  const graph=generateProject(brief).graph;
  assert.equal(graph.nodes.find(node=>node.id==='WT02.cure').duration,14);
  assert.equal(graph.nodes.find(node=>node.id==='WT02.cure').estimated,false);
  const selected=graph.nodes.find(node=>node.id==='WT01.excavate');
  const edited=engine.edit(graph,[{op:'put-node',node:{...selected,duration:3}}]);
  assert.equal(edited.nodes.find(node=>node.id===selected.id).estimated,false);
  assert.deepEqual(edited.project,graph.project);
  catalog.wind.steps[0].after=['grid'];
  assert.throws(()=>generateProject(brief),/循环/);
  assert.throws(()=>generateProject({version:1,name:'超大项目',units:[{type:'wind',count:200}]}),/1000/);
});

test('CLI generates graph and SVG directly from a text description over stdin',()=>{
  const input='项目名称：命令行生成\n2台风机、1座升压站、3回集电线路。';
  const options={input,encoding:'utf8'};
  const graph=spawnSync(process.execPath,['bin/griddraft.cjs','project','-'],options);
  assert.equal(graph.status,0,graph.stderr);
  assert.equal(JSON.parse(graph.stdout).project.units[0].count,2);
  const svg=spawnSync(process.execPath,['bin/griddraft.cjs','project','-','--format','svg'],options);
  assert.equal(svg.status,0,svg.stderr);
  assert.match(svg.stdout,/双代号网络图/);
  assert.match(svg.stdout,/工期待估算/);
});
