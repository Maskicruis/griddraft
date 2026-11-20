'use strict';

const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const test = require('node:test');
const fuyu = require('../examples/fuyu-demo.json');
const {modelSettings} = require('../src/settings.cjs');

test('model endpoints accept DeepSeek and normalize SiliconFlow completion paths', () => {
  assert.equal(modelSettings({provider:'compatible',model:'test',endpoint:'https://api.siliconflow.cn//chat/completions'}).endpoint,
    'https://api.siliconflow.cn/v1');
  assert.equal(modelSettings({provider:'deepseek',model:'test',endpoint:'https://api.deepseek.com'}).endpoint,
    'https://api.deepseek.com/anthropic');
  assert.throws(()=>modelSettings({provider:'compatible',model:'test',endpoint:'https://example.com/?token=test'}));
});

test('official Harness loop uses a third-party gateway, runs GridDraft tools and returns a draft', async t => {
  const {runHarness} = await import('../src/harness.mjs');
  const requests = [];
  const server = createServer(async (req,res) => {
    const body = JSON.parse(await Array.fromAsync(req).then(chunks=>Buffer.concat(chunks).toString()));
    requests.push({path:req.url,auth:req.headers.authorization,body});
    const first = requests.length === 1;
    const delta = first ? {role:'assistant',tool_calls:[{index:0,id:'trial-1',type:'function',
      function:{name:'simulate_durations',arguments:'{"changes":[{"id":"RD","days":10}]}'}}]} :
      {role:'assistant',content:'道路增加 1 天，试算总工期 35 天。'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for (const [change, finish_reason] of [[delta,null],[{},first?'tool_calls':'stop']]) {
      res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',
        choices:[{index:0,delta:change,finish_reason}]})+'\n\n');
    }
    res.end('data: [DONE]\n\n');
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const events=[];
  const result=await runHarness({provider:'compatible',endpoint:'http://127.0.0.1:'+server.address().port+'/v1',model:'fixture',key:'fixture-key'},
    {graph:fuyu,question:'请试算道路延至 10 天。'}, {signal:AbortSignal.timeout(20000),emit:event=>events.push(event)});
  assert.deepEqual(requests.map(r=>r.path),['/v1/chat/completions','/v1/chat/completions']);
  assert.ok(requests.every(r=>r.auth==='Bearer fixture-key'));
  assert.ok(['inspect_schedule','list_tasks','edit_network','replace_network','list_links','interface_action'].every(
    name=>requests[0].body.tools.some(tool=>tool.function.name===name)));
  assert.match(requests[1].body.messages.find(message=>message.role==='tool').content,/"after":35/);
  assert.equal(result.draft.before,34);
  assert.equal(result.draft.after,35);
  assert.match(result.draft.changes[0].description,/RD.*9 → 10/);
  assert.match(result.answer,/35 天/);
  assert.equal(events.find(e=>e.kind==='tool').name,'simulate_durations');
  assert.equal(fuyu.nodes.find(node=>node.id==='RD').duration,9);
});

test('the official DeepSeek adapter uses Messages streaming with the configured key', async t => {
  const {runHarness} = await import('../src/harness.mjs');
  let request;
  const server=createServer(async (req,res)=>{
    request={path:req.url,key:req.headers['x-api-key'],body:JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString())};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const blocks=[
      {type:'message_start',message:{id:'msg_fixture',model:'fixture',usage:{input_tokens:4,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'OK'}},
      {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:2}},
      {type:'message_stop'}
    ];
    for(const block of blocks) res.write('event: '+block.type+'\ndata: '+JSON.stringify(block)+'\n\n');
    res.end();
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const result=await runHarness({provider:'deepseek',endpoint:'http://127.0.0.1:'+server.address().port+'/anthropic',model:'fixture',key:'fixture-key'},
    {question:'回复 OK'},{signal:AbortSignal.timeout(10000)});
  assert.equal(result.answer,'OK');
  assert.equal(request.path,'/anthropic/v1/messages');
  assert.equal(request.key,'fixture-key');
  assert.equal(request.body.model,'fixture');
});

test('a rejected gateway key reports the HTTP error and a cancelled turn exits', async t => {
  const {runHarness} = await import('../src/harness.mjs');
  const server=createServer(async(req,res)=>{
    await Array.fromAsync(req);
    if(req.url.startsWith('/hang/'))return;
    res.writeHead(401,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:{message:'Invalid API key',type:'authentication_error'}}));
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const origin='http://127.0.0.1:'+server.address().port;
  const config={provider:'compatible',endpoint:origin+'/v1',model:'fixture',key:'fixture-key'};
  await assert.rejects(()=>runHarness(config,{question:'测试'},{signal:AbortSignal.timeout(4000)}),/HTTP 401/);
  await assert.rejects(()=>runHarness({...config,endpoint:origin+'/hang/v1'},{question:'测试'},
    {signal:AbortSignal.timeout(100)}),error=>error.name==='TimeoutError');
});
