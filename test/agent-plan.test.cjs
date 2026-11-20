'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {GraphWorkspace}=require('../src/agent-plan.cjs');
const fuyu=require('../examples/fuyu-demo.json');

test('network edits are cumulative and preserve omitted fields, then apply atomically',()=>{
  const workspace=new GraphWorkspace(fuyu);
  workspace.edit([
    {op:'put-node',node:{id:'QC',label:'基础质量验收',duration:2}},
    {op:'remove-edge',id:'e4'},
    {op:'put-edge',edge:{id:'b-qc',from:'F08-B',to:'QC'}},
    {op:'put-edge',edge:{id:'qc-l',from:'QC',to:'F08-L',lag:1}}
  ]);
  workspace.sync(fuyu,{selection:{kind:'node',id:'QC'}});
  workspace.edit([{op:'put-node',node:{id:'QC',label:'混凝土质量验收'}}]);
  assert.equal(workspace.graph.nodes.find(node=>node.id==='QC').duration,2);
  assert.ok(!fuyu.nodes.some(node=>node.id==='QC'));
  const proposal=workspace.proposal();
  assert.ok(proposal.changes.some(change=>change.id==='e4'&&change.kind==='removed'));
  const applied=workspace.apply(fuyu,proposal.id);
  assert.ok(applied.nodes.some(node=>node.label==='混凝土质量验收'));
  assert.equal(workspace.proposal(),null);
});

test('invalid batches roll back, stale drafts cannot apply and external edits replace draft context',()=>{
  const workspace=new GraphWorkspace(fuyu);
  workspace.edit([{op:'put-node',node:{id:'RD',duration:10}}]);
  const staged=JSON.stringify(workspace.graph);
  assert.throws(()=>workspace.edit([
    {op:'put-node',node:{id:'RD',duration:11}},
    {op:'put-edge',edge:{id:'bad',from:'missing',to:'RD'}}
  ]),/不存在/);
  assert.equal(JSON.stringify(workspace.graph),staged);
  const original=workspace.proposal();
  workspace.edit([{op:'set-title',value:'新标题'}]);
  assert.throws(()=>workspace.apply(fuyu,original.id),/草稿已变化/);
  const external={...fuyu,title:'现场手工修改'};
  assert.throws(()=>workspace.apply(external,workspace.proposal().id),/当前网络图已变化/);
  assert.equal(workspace.sync(external),true);
  assert.equal(workspace.proposal(),null);
  assert.equal(workspace.describe().title,'现场手工修改');
});

test('whole-network creation, removal, undo and calculation issues use the same graph contract',()=>{
  const workspace=new GraphWorkspace({version:1,title:'空图',nodes:[],edges:[]});
  workspace.replace(fuyu);
  workspace.edit([{op:'remove-node',id:'F08-P'}]);
  assert.ok(workspace.graph.edges.every(edge=>edge.from!=='F08-P'&&edge.to!=='F08-P'));
  workspace.undo();
  assert.equal(workspace.describe().days,34);
  workspace.edit([{op:'put-edge',edge:{id:'loop',from:'FINISH',to:'RD'}}]);
  assert.equal(workspace.proposal().issues[0].code,'CYCLE');
  assert.equal(workspace.proposal().after,null);
  workspace.discard();
  assert.equal(workspace.graph.nodes.length,0);
});
