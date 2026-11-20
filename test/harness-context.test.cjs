'use strict';

const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const test=require('node:test');
const fuyu=require('../examples/fuyu-demo.json');

test('a persistent Harness conversation edits structure, follows up on its draft and queues software actions',async t=>{
  const {createHarnessSession}=await import('../src/harness.mjs');
  const script=[
    {tool:'edit_network',args:{operations:[
      {op:'put-node',node:{id:'QC',label:'质量验收',duration:2}},
      {op:'remove-edge',id:'e2'},
      {op:'put-edge',edge:{id:'rd-qc',from:'RD',to:'QC'}},
      {op:'put-edge',edge:{id:'qc-p',from:'QC',to:'F08-P'}}
    ]}},
    {text:'已插入质量验收，草稿工期 36 天。'},
    {tool:'list_tasks',args:{query:'QC'}},
    {tool:'edit_network',args:{operations:[{op:'put-node',node:{id:'QC',label:'道路验收',duration:3}}]}},
    {tool:'interface_action',args:{action:'view',view:'table'}},
    {text:'刚新增的工序已改为道路验收，持续 3 天。'},
    {tool:'edit_network',args:{operations:[
      {op:'remove-node',id:'QC'},{op:'put-edge',edge:{id:'e2',from:'RD',to:'F08-P'}}
    ]}},
    {text:'已删除该工序并恢复原紧前关系。'}
  ];
  const requests=[];
  const server=createServer(async(req,res)=>{
    requests.push(JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString()));
    const response=script.shift();
    if(!response){res.writeHead(500);res.end();return;}
    const delta=response.tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+requests.length,type:'function',
      function:{name:response.tool,arguments:JSON.stringify(response.args)}}]}:{role:'assistant',content:response.text};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const [change,finish_reason] of [[delta,null],[{},response.tool?'tool_calls':'stop']]){
      res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',
        choices:[{index:0,delta:change,finish_reason}]})+'\n\n');
    }
    res.end('data: [DONE]\n\n');
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const session=await createHarnessSession({provider:'compatible',model:'fixture',key:'fixture-key',
    endpoint:'http://127.0.0.1:'+server.address().port+'/v1'});
  t.after(()=>session.dispose());
  const options={signal:AbortSignal.timeout(15000)};
  const first=await session.run({graph:fuyu,question:'道路和桩基之间插入质量验收，工期2天。',
    context:{view:'time',selection:{kind:'node',id:'RD'}}},options);
  assert.equal(first.draft.after,36);
  const second=await session.run({graph:fuyu,question:'把刚才新增那道改成三天，改名为道路验收，展示工作表。',
    context:{view:'time',selection:{kind:'node',id:'RD'}}},options);
  assert.equal(second.draft.after,37);
  assert.deepEqual(second.actions,[{action:'view',view:'table'}]);
  assert.ok(requests[2].messages.some(message=>message.role==='assistant'&&message.content?.includes('已插入质量验收')));
  assert.ok(requests[3].messages.some(message=>message.role==='tool'&&message.content.includes('质量验收')));
  const current=session.apply(fuyu,second.draft.id);
  assert.equal(current.nodes.find(node=>node.id==='QC').duration,3);
  assert.equal(current.nodes.find(node=>node.id==='QC').label,'道路验收');
  const third=await session.run({graph:current,question:'删除这道验收，接回道路到桩基。',
    context:{view:'table',selection:{kind:'node',id:'QC'}}},options);
  assert.equal(third.draft.after,34);
  assert.ok(third.draft.changes.some(change=>change.kind==='removed'&&change.id==='qc-p'));
  assert.deepEqual(third.actions,[]);
  assert.ok(!session.apply(current,third.draft.id).nodes.some(node=>node.id==='QC'));
  assert.equal(script.length,0);
});
