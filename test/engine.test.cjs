'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const engine=require('../src/engine.cjs');
const demo=require('../examples/fuyu-demo.json');
const loop=require('../examples/review-loop.json');

test('the example has a checked critical path and a generic feedback loop still renders',async()=>{
  const c=engine.cpm(demo);
  assert.equal(c.duration,34);
  assert.equal(c.nodes.find(n=>n.id==='F08-T').tf,4);
  assert.deepEqual(c.criticalEdges,['e1','e2','e3','e7','e9']);
  const cyclic={...loop,nodes:loop.nodes.map(n=>({...n,duration:n.kind==='milestone'?0:1}))};
  assert.throws(()=>engine.cpm(cyclic),{code:'CYCLE'});
  const graph=await engine.layout(cyclic);
  assert.ok(graph.edges.every(e=>e.points.length>=2));
  assert.match((await engine.render(graph)).svg,/退回/);
  const withLoop=engine.edit(cyclic,[{op:'put-edge',edge:{id:'self',from:'review',to:'review'}}]);
  assert.ok((await engine.layout(withLoop)).edges.find(e=>e.id==='self').points.length>=3);
});

test('layout is reproducible, edits invalidate only incident routes and SVG labels remain escaped',async()=>{
  const a=await engine.layout(demo),b=await engine.layout(demo);
  assert.deepEqual(a,b);
  const task=a.nodes[1];
  const result=engine.edit(a,[{op:'put-node',node:{...task,label:'<script>&',position:{x:200,y:200}}}]);
  assert.equal(result.edges.find(e=>e.from===task.id).points,undefined);
  assert.ok(result.edges.find(e=>e.from==='CL-C').points);
  assert.match((await engine.render(result)).svg,/&lt;script&gt;&amp;/);
  assert.throws(()=>engine.edit(a,[{op:'put-edge',edge:{id:'bad',from:'missing',to:task.id}}]),{code:'INVALID_GRAPH'});
  assert.equal(a.edges.length,10);
});

test('CLI supports JSON stdin, patches, determinism and partial-success batch output',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'GridDraft 批处理 '));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const cli=(...args)=>spawnSync(process.execPath,[path.resolve(__dirname,'../bin/griddraft.cjs'),...args],
    {input:JSON.stringify(demo),encoding:'utf8',windowsHide:true});
  assert.equal(JSON.parse(cli('validate','-').stdout).nodes,9);
  const xml=cli('render','-','--critical');
  assert.equal(xml.status,0,xml.stderr);
  assert.equal(xml.stdout.trim(),(await engine.render(demo,{critical:true})).svg);
  const from=path.join(folder,'输入'),to=path.join(folder,'输出');
  await fs.mkdir(from);
  await fs.writeFile(path.join(from,'计划.json'),JSON.stringify(demo));
  await fs.writeFile(path.join(from,'异常.json'),'{bad');
  const result=cli('batch',from,'--out',to);
  assert.equal(result.status,3);
  assert.equal(JSON.parse(result.stdout).failures,1);
  assert.ok(await fs.stat(path.join(to,'计划.svg')));
  const patch=path.join(folder,'change.json');
  await fs.writeFile(patch,'[{"op":"set-title","value":"新名称"}]');
  assert.equal(JSON.parse(cli('edit','-','--patch',patch).stdout).title,'新名称');
  assert.equal(cli('validate','-','--not-supported').status,2);
});
