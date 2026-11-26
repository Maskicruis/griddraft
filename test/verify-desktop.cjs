'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const net=require('node:net');
const http=require('node:http');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {setTimeout:sleep}=require('node:timers/promises');
const {chromium}=require(process.env.GRIDDRAFT_PLAYWRIGHT||'playwright');

function modelFixture(){
  return http.createServer(async(req,res)=>{
    const data=JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString());
    assert.equal(req.url,'/v1/chat/completions');
    assert.equal(req.headers.authorization,'Bearer grid-verification-key');
    const lastUser=data.messages.findLastIndex(message=>message.role==='user');
    const prompt=String(data.messages[lastUser]?.content);
    const completed=data.messages.slice(lastUser+1).filter(message=>message.role==='tool').length;
    let command=null,answer=data.tools?.length?'试算工期 35 天。':'OK';
    if(data.tools?.length&&completed===0){
      if(prompt.includes('插入验收')){
        command={name:'edit_network',arguments:JSON.stringify({operations:[
          {op:'put-node',node:{id:'QC',label:'质量验收',duration:2}},
          {op:'remove-edge',id:'e2'},
          {op:'put-edge',edge:{id:'rd-qc',from:'RD',to:'QC'}},
          {op:'put-edge',edge:{id:'qc-p',from:'QC',to:'F08-P'}}
        ]})};
      }else if(prompt.includes('刚才新增')){
        command={name:'edit_network',arguments:JSON.stringify({operations:[
          {op:'put-node',node:{id:'QC',label:'道路验收',duration:4}}
        ]})};
      }else command={name:'simulate_durations',arguments:'{"changes":[{"id":"RD","days":10}]}'};
    }
    if(prompt.includes('刚才新增')&&completed===1){
      command={name:'interface_action',arguments:'{"action":"view","view":"table"}'};
    }
    if(prompt.includes('插入验收'))answer='已插入验收工序，工期 36 天。';
    if(prompt.includes('刚才新增'))answer='道路验收改为 4 天，草稿总工期 38 天。';
    const delta=command?{role:'assistant',tool_calls:[{index:0,id:'call-'+data.messages.length,type:'function',function:command}]}:
      {role:'assistant',content:answer};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const [change,finish_reason] of [[delta,null],[{},command?'tool_calls':'stop']]){
      res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',
        choices:[{index:0,delta:change,finish_reason}]})+'\n\n');
    }
    res.end('data: [DONE]\n\n');
  });
}

async function connectDesktop(port){
  for(let i=0;i<80;i++){
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/version');
      if(response.ok)return chromium.connectOverCDP((await response.json()).webSocketDebuggerUrl);
    }catch{}
    await sleep(500);
  }
  throw Error('Desktop debug endpoint did not start.');
}

async function desktopPage(browser){
  for(let i=0;i<120;i++){
    const page=browser.contexts()[0]?.pages().find(p=>p.url().startsWith('file:'));
    if(page)return page;
    await sleep(250);
  }
  throw Error('Desktop application page did not finish opening.');
}

async function run(){
  const [exe,output]=process.argv.slice(2);
  await fs.mkdir(output,{recursive:true});
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'griddraft-verification-'));
  const portServer=net.createServer();
  await new Promise(r=>portServer.listen(0,'127.0.0.1',r));
  const port=portServer.address().port;
  await new Promise(r=>portServer.close(r));
  const launch=()=>spawn(path.resolve(exe),['--isolated-test','--workspace='+workspace,'--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore'});
  let subprocess=launch();
  const gateway=modelFixture();
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await connectDesktop(port);
    let page=await desktopPage(browser);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.locator('#projectDialog').waitFor({timeout:15000});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#projectExcel').click();
    await page.locator('#excelDialog').waitFor();
    await page.locator('#excelFile').setInputFiles(path.join(__dirname,'../examples/excel-plan.xlsx'));
    await page.waitForFunction(()=>!document.querySelector('#excelGenerate').disabled);
    assert.equal(await page.locator('#excelRows tr').count(),4);
    await page.screenshot({path:path.join(output,'10-Excel计划导入.png')});
    await page.locator('#excelGenerate').click();
    await page.locator('#excelDialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#stage [data-kind="activity"]').count(),3);
    assert.match(await page.locator('#status').textContent(),/12 天/);
    await page.locator('#networkTime').click();
    await page.locator('#stage svg[data-layout="adaptive-time"]').waitFor();
    assert.ok(parseInt(await page.locator('#zoom').textContent(),10)>=78);
    const flow=page.locator('#stage .network-flow').first();
    assert.equal(await flow.evaluate(node=>getComputedStyle(node).animationName),'grid-flow');
    const offset=await flow.evaluate(node=>getComputedStyle(node).strokeDashoffset);
    await page.waitForFunction(value=>getComputedStyle(document.querySelector('#stage .network-flow')).strokeDashoffset!==value,offset);
    await page.locator('#flowMotion').click();
    assert.equal(await flow.evaluate(node=>getComputedStyle(node).display),'none');
    await page.locator('#flowMotion').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await flow.evaluate(node=>getComputedStyle(node).display),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.screenshot({path:path.join(output,'11-自适应时标与流动箭线.png')});
    if(process.env.GRIDDRAFT_REFERENCE_XLSX){
      await page.locator('#excelOpen').click();
      await page.locator('#excelFile').setInputFiles(process.env.GRIDDRAFT_REFERENCE_XLSX);
      await page.waitForFunction(()=>document.querySelectorAll('#excelRows tr').length===191);
      await page.waitForFunction(()=>document.querySelector('#excelStatus').textContent.includes('待核对'));
      assert.equal(await page.locator('#excelGenerate').isDisabled(),true);
      await page.screenshot({path:path.join(output,'12-升压站191条原始记录.png')});
      await page.locator('#excelClose').click();
    }
    await page.locator('#projectOpen').click();
    await page.locator('#projectText').fill('项目名称：项目生成验收\n2台风机、一座升压站、集电线路30公里，桩基础。');
    await page.locator('#projectRead').click();
    await page.waitForFunction(()=>document.querySelector('#projectName').value==='项目生成验收');
    assert.equal(await page.locator('#projectUnits input[aria-label="风机 count"]').inputValue(),'2');
    await page.locator('#templatePreview').click();
    await page.locator('#draftDialog').waitFor();
    assert.equal(await page.locator('#draftCanvas [data-kind="activity"]').count(),12);
    await page.locator('#previewClose').click();
    await page.screenshot({path:path.join(output,'07-项目概况与模块模板.png')});
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#projectGenerate').click();
    await page.locator('#projectDialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#unitScope option').count(),5);
    assert.match(await page.locator('#projectNotice').textContent(),/占位值/);
    await page.locator('#stage [data-module][data-unit="WT01"]').first().waitFor();
    assert.equal(await page.locator('#summaryView').getAttribute('aria-pressed'),'true');
    const sourceBefore=await page.locator('#status').textContent();
    assert.match(sourceBefore,/39 个源节点/);
    await page.screenshot({path:path.join(output,'09-重复模块总览.png')});
    await page.locator('#stage [data-module][data-unit="WT01"]').first().click();
    await page.waitForFunction(()=>document.querySelector('#projectNotice').textContent.includes('单位工程内部'));
    assert.equal(await page.locator('#unitScope').inputValue(),'WT01');
    assert.match(await page.locator('#projectNotice').textContent(),/重复组共 2 个实例/);
    assert.equal(await page.locator('#stage [data-kind="activity"]').count(),12);
    assert.equal(await page.locator('#objects .object').count(),12);
    await page.screenshot({path:path.join(output,'08-单位工程模块网络.png')});
    await page.locator('#unitScope').selectOption('WT02');
    await page.waitForFunction(()=>document.querySelector('#canvas').getAttribute('aria-busy')==='false'&&document.querySelector('#unitScope').value==='WT02');
    assert.equal(await page.locator('#stage [data-kind="activity"]').count(),12);
    await page.locator('#summaryBack').click();
    await page.locator('#stage [data-module][data-unit="WT01"]').first().waitFor();
    assert.equal(await page.locator('#status').textContent(),sourceBefore);
    await page.locator('#stage [data-module][data-unit="WT01"]').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#unitScope').value==='WT01');
    await page.locator('#add').click();
    await page.locator('#nodeForm input[name=label]').fill('模块补充工序');
    await page.locator('#nodeForm input[name=duration]').fill('2');
    await page.getByRole('button',{name:'添加节点',exact:true}).click();
    await page.locator('#nodeDialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#objects .object').count(),13);
    await page.locator('#undo').click();
    await page.waitForFunction(()=>document.querySelectorAll('#objects .object').length===12);
    await page.locator('#unitScope').selectOption('');
    await page.waitForFunction(()=>document.querySelectorAll('#stage [data-kind="activity"]').length===36);
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#demo').click();
    await page.waitForFunction(()=>document.querySelectorAll('#stage [data-kind="activity"]').length===7);
    try{await page.locator('#stage [data-event]').first().waitFor({timeout:15000});}
    catch(error){console.error(await page.locator('#status').textContent());throw error;}
    assert.equal(await page.locator('#stage [data-kind="activity"]').count(),7);
    assert.equal(await page.locator('#stage [data-kind="activity"][data-critical="true"]').count(),4);
    await page.locator('#settingsOpen').click();
    await page.waitForFunction(()=>document.querySelector('#settingsVersion').textContent.startsWith('V'));
    await page.locator('#provider').selectOption('compatible');
    await page.locator('#modelForm input[name=endpoint]').fill('http://127.0.0.1:'+gateway.address().port+'/v1/chat/completions');
    await page.locator('#modelForm input[name=model]').fill('fixture');
    await page.locator('#modelForm input[name=key]').fill('grid-verification-key');
    await page.locator('#modelTest').click();
    try{
      await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('连接成功'),null,{timeout:20000});
    }catch(error){console.error(await page.locator('#modelStatus').textContent());throw error;}
    await page.locator('#modelSave').click();
    await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('密钥已保存'));
    assert.ok(!(await fs.readFile(path.join(workspace,'model-settings.json'),'utf8')).includes('grid-verification-key'));
    await page.screenshot({path:path.join(output,'04-模型配置.png')});
    await page.locator('[data-settings="plugins"]').click();
    assert.match(await page.locator('[data-setting-panel="plugins"]').textContent(),/暂无第三方插件/);
    await page.locator('[data-settings="updates"]').click();
    assert.equal(await page.locator('#updateCheck').isVisible(),true);
    await page.locator('#settingsClose').click();
    const exited=new Promise((resolve,reject)=>{
      const deadline=setTimeout(()=>reject(Error('Desktop did not close.')),10000);
      subprocess.once('exit',()=>{clearTimeout(deadline);resolve();});
    });
    const shutdown=await browser.newBrowserCDPSession();
    shutdown.send('Browser.close').catch(()=>{});
    await exited;
    await browser.close();
    subprocess=launch();
    browser=await connectDesktop(port);
    page=await desktopPage(browser);
    page.on('pageerror',error=>errors.push(error.message));
    await page.locator('#projectDialog').waitFor();
    await page.locator('#projectClose').click();
    await page.locator('#excelOpen').click();
    await page.waitForFunction(()=>document.querySelectorAll('#excelRows tr').length>0);
    assert.equal(await page.locator('#excelRows tr').count(),process.env.GRIDDRAFT_REFERENCE_XLSX?191:4);
    await page.locator('#excelClose').click();
    await page.locator('#demo').click();
    await page.locator('#stage [data-event]').first().waitFor();
    await page.locator('#agentOpen').click();
    await page.locator('#agentQuestion').fill('把道路工期延长至 10 天，请试算。');
    await page.locator('#agentSend').click();
    try{await page.locator('#agentDraft').waitFor({timeout:20000});}
    catch(error){
      console.error(await page.locator('#agentMessages').textContent());
      console.error('Settings file exists:',Boolean(await fs.stat(path.join(workspace,'model-settings.json')).catch(()=>null)));
      await page.screenshot({path:path.join(output,'debug-restart.png')});
      throw error;
    }
    assert.match(await page.locator('#draftTitle').textContent(),/34 → 35 天/);
    assert.match(await page.locator('#agentMessages').textContent(),/试算工期 35 天/);
    assert.match(await page.locator('#status').textContent(),/34 天/);
    await page.screenshot({path:path.join(output,'05-计划智能体.png')});
    await page.locator('#draftApply').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('35 天'));
    await page.locator('#undo').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('34 天'));
    await page.locator('#agentQuestion').fill('在道路后插入验收，然后接回桩基。');
    await page.locator('#agentSend').click();
    await page.waitForFunction(()=>document.querySelector('#draftTitle').textContent.includes('36 天'));
    await page.locator('#draftPreview').click();
    await page.locator('#draftCanvas [data-kind="activity"]').first().waitFor();
    assert.equal(await page.locator('#draftCanvas [data-kind="activity"]').count(),8);
    assert.match(await page.locator('#status').textContent(),/34 天/);
    await page.locator('#previewClose').click();
    await page.locator('#agentQuestion').fill('把刚才新增那道改为4天，名称改为道路验收，并展示工作表。');
    await page.locator('#agentSend').click();
    await page.waitForFunction(()=>document.querySelector('#draftTitle').textContent.includes('38 天'));
    assert.match(await page.locator('#draftChanges').textContent(),/QC.*道路验收/);
    await page.screenshot({path:path.join(output,'06-连续对话编辑网络.png')});
    await page.locator('#draftApply').click();
    await page.locator('#workTable').getByRole('button',{name:'道路验收',exact:true}).waitFor();
    await page.locator('#agentClose').click();
    await page.locator('#workTable').getByRole('button',{name:'道路验收',exact:true}).click();
    assert.equal(await page.locator('#properties input[name=duration]').inputValue(),'4');
    await page.locator('#undo').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('34 天'));
    await page.locator('#networkTime').click();
    await page.locator('#stage [data-event]').first().locator('text').first().click({timeout:5000});
    assert.match(await page.locator('#properties').textContent(),/事件 1.*最早发生 D0/);
    await page.screenshot({path:path.join(output,'01-双代号时标.png')});
    await page.locator('#networkLogic').click();
    await page.waitForFunction(()=>document.querySelector('#stage svg > title').textContent.endsWith('双代号网络图'));
    await page.screenshot({path:path.join(output,'02-双代号结构.png')});
    await page.locator('#workList').click();
    await page.locator('#workTable tbody button').first().waitFor();
    assert.equal(await page.locator('#workTable tbody button').count(),7);
    await page.locator('#workTable').getByRole('button',{name:'进场道路',exact:true}).click();
    assert.equal(await page.locator('#properties input[name=id]').inputValue(),'RD');
    await page.screenshot({path:path.join(output,'03-工作时差表.png')});
    await page.locator('#properties input[name=duration]').fill('10');
    await page.getByRole('button',{name:'应用修改',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('35 天'));
    await page.locator('#undo').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('34 天'));
    await page.locator('#flowView').click();
    await page.locator('#stage [data-node="RD"]').waitFor();
    assert.equal(await page.locator('#stage [data-node]').count(),9);
    await page.locator('#cpm').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('34 天'));
    await page.locator('#timelineView').click();
    await page.locator('#timeline .time-row[data-id="RD"]').waitFor();
    assert.equal(await page.locator('#timeline .time-row[data-id]').count(),9);
    await page.locator('#timeline .time-row[data-id="RD"] button').click();
    assert.equal(await page.locator('#properties input[name=id]').inputValue(),'RD');
    await page.locator('#timelineView').click();
    const node=page.locator('#stage [data-node="RD"]');
    await node.waitFor();
    const before=await node.getAttribute('transform');
    const box=await node.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+45,box.y+box.height/2+50,{steps:6});
    await page.mouse.up();
    await page.waitForFunction(expected=>document.querySelector('[data-node="RD"]').getAttribute('transform')!==expected,before);
    await page.waitForFunction(()=>document.querySelector('#canvas').dataset===undefined||document.querySelector('#canvas').getAttribute('aria-busy')==='false');
    await page.locator('#undo').click();
    await page.waitForFunction(expected=>document.querySelector('[data-node="RD"]').getAttribute('transform')===expected,before);
    await page.locator('#add').click();
    await page.locator('#nodeForm input[name=label]').fill('新工作面');
    await page.locator('#nodeForm input[name=duration]').fill('2');
    await page.getByRole('button',{name:'添加节点',exact:true}).click();
    await page.locator('#nodeDialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#stage [data-node]').count(),10);
    await page.locator('#link').click();
    await page.locator('#stage [data-node="FINISH"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#stage [data-edge]').length===11);
    assert.equal(await page.locator('#properties select[name=to]').inputValue(),'FINISH');
    assert.deepEqual(errors,[]);
    const result={excelImport:true,excelSurvivesRestart:true,adaptiveTimeLayout:true,flowingArrows:true,reducedMotion:true,repeatedModuleSummary:true,clickDrillDown:true,keyboardDrillDown:true,returnToSummary:true,projectIntake:true,moduleTemplates:true,unitScope:true,modelSettings:true,credentialsSurviveRestart:true,harnessDraft:true,fullNetworkEditing:true,
      multiTurnContext:true,draftPreview:true,pluginPlaceholder:true,timeScaledNetwork:true,structuralNetwork:true,
      workTableRecalculates:true, guiTimeline:true, drawAndConnect:true, positionUndo:true, criticalPathDays:34};
    await fs.writeFile(path.join(output,'gui-verification.json'),JSON.stringify(result,null,2),'utf8');
    console.log(JSON.stringify(result));
  }finally{
    gateway.closeAllConnections();gateway.close();
    await browser?.close().catch(()=>{});
    if(subprocess.exitCode===null)spawnSync('taskkill',['/PID',String(subprocess.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
