'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {setTimeout:sleep}=require('node:timers/promises');
const {chromium}=require(process.env.GRIDDRAFT_PLAYWRIGHT||'playwright');

async function run(){
  const [exe,output]=process.argv.slice(2);
  await fs.mkdir(output,{recursive:true});
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'griddraft-verification-'));
  const portServer=net.createServer();
  await new Promise(r=>portServer.listen(0,'127.0.0.1',r));
  const port=portServer.address().port;
  await new Promise(r=>portServer.close(r));
  const subprocess=spawn(path.resolve(exe),['--isolated-test','--workspace='+workspace,'--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore'});
  let browser;
  try{
    let cdp;
    for(let i=0;i<80;i++){
      try{const r=await fetch('http://127.0.0.1:'+port+'/json/version');if(r.ok){cdp=await r.json();break;}}catch{}
      await sleep(500);
    }
    assert.ok(cdp,'Desktop debug endpoint did not start.');
    browser=await chromium.connectOverCDP(cdp.webSocketDebuggerUrl);
    const context=browser.contexts()[0];
    const page=context.pages().find(p=>p.url().startsWith('file:'))||await context.waitForEvent('page');
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{await page.locator('#stage [data-event]').first().waitFor({timeout:15000});}
    catch(error){console.error(await page.locator('#status').textContent());throw error;}
    assert.equal(await page.locator('#stage [data-kind="activity"]').count(),7);
    assert.equal(await page.locator('#stage [data-kind="activity"][data-critical="true"]').count(),4);
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
    const result={timeScaledNetwork:true, structuralNetwork:true, workTableRecalculates:true, guiTimeline:true, drawAndConnect:true, positionUndo:true, criticalPathDays:34};
    await fs.writeFile(path.join(output,'gui-verification.json'),JSON.stringify(result,null,2),'utf8');
    console.log(JSON.stringify(result));
  }finally{
    await browser?.close().catch(()=>{});
    if(subprocess.exitCode===null)spawnSync('taskkill',['/PID',String(subprocess.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
