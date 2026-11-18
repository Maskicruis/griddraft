'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createServer}=require('node:http');
const {mkdtemp,readFile,readdir,rm,writeFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {chooseUpdate,downloadUpdate}=require('../src/update.cjs');

test('updates accept versioned GridDraft release assets and ignore older releases',()=>{
  const name='GridDraft-Desktop-0.10.0-x64.exe';
  const release={tag_name:'v0.10.0',assets:[{name,size:35,digest:'sha256:'+'a'.repeat(64),
    browser_download_url:'https://github.com/Maskicruis/griddraft/releases/download/v0.10.0/'+name}]};
  assert.equal(chooseUpdate(release,'0.9.9').available,true);
  assert.equal(chooseUpdate(release,'1.0.0').available,false);
  assert.throws(()=>chooseUpdate({...release,assets:[{...release.assets[0],browser_download_url:'https://example.net/'+name}]},'0.9.9'),/缺少可验证/);
});

test('a broken download preserves the original executable and a valid payload replaces it',async t=>{
  const bytes=Buffer.from('grid test file');
  const server=createServer((_req,res)=>res.end(bytes)).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const directory=await mkdtemp(join(tmpdir(),'griddraft-update-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const target=join(directory,'GridDraft.exe');
  const update={url:'http://127.0.0.1:'+server.address().port,size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex')};
  await writeFile(target,'original');
  await assert.rejects(()=>downloadUpdate({...update,hash:'bad'},target),/完整性校验失败/);
  assert.equal(await readFile(target,'utf8'),'original');
  assert.deepEqual(await readdir(directory),['GridDraft.exe']);
  await downloadUpdate(update,target);
  assert.deepEqual(await readFile(target),bytes);
});
