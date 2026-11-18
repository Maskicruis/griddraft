'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repository = 'https://github.com/Maskicruis/griddraft';
const latest = 'https://api.github.com/repos/Maskicruis/griddraft/releases/latest';
const releasePage = repository+'/releases/latest';
const semver = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

function chooseUpdate(release, current) {
  const tag = typeof release.tag_name==='string' ? release.tag_name : '';
  const version = tag.slice(1);
  if (!tag.startsWith('v') || !semver.test(version) || !semver.test(current) || release.draft || release.prerelease) {
    throw Error('GitHub 发布信息中的正式版本无效。');
  }
  const here = current.split('.').map(Number);
  const there = version.split('.').map(Number);
  const difference = there.map((n,i)=>n-here[i]).find(Boolean)??0;
  if (difference<=0) return {version,current,available:false,notes:''};
  const name = 'GridDraft-Desktop-'+version+'-x64.exe';
  const url = repository+'/releases/download/'+tag+'/'+name;
  const asset = release.assets?.find(item=>item.name===name && item.browser_download_url===url);
  if (!asset || !/^sha256:[a-f\d]{64}$/i.test(asset.digest??'') ||
    !Number.isSafeInteger(asset.size) || asset.size<1 || asset.size>512*1024*1024) {
    throw Error('新版发布缺少可验证的 Windows 安装包。');
  }
  return {version,current,available:true,name,url,hash:asset.digest.slice(7).toLowerCase(),size:asset.size,
    notes:typeof release.body==='string'?release.body.slice(0,900):''};
}

async function checkUpdates(current) {
  const response = await fetch(latest,{headers:{Accept:'application/vnd.github+json','User-Agent':'GridDraft/'+current},
    signal:AbortSignal.timeout(12000),redirect:'error'});
  if (!response.ok) throw Error('无法检查 GitHub 更新（HTTP '+response.status+'）。');
  return chooseUpdate(await response.json(),current);
}

async function downloadUpdate(update, target, progress=()=>{}) {
  const temporary = target+'.'+randomUUID()+'.partial';
  try {
    const signal = AbortSignal.timeout(10*60*1000);
    const download = await fetch(update.url,{signal});
    if (!download.ok || !download.body) throw Error('下载失败（HTTP '+download.status+'）。');
    const digest = createHash('sha256');
    let size = 0, last = -1;
    const verify = new Transform({transform(chunk,_encoding,done) {
      size+=chunk.length;
      if (size>update.size) return done(Error('下载数据超出发布包大小。'));
      digest.update(chunk);
      const percent=Math.floor(size*100/update.size);
      if (last!==percent) { last=percent; progress(percent); }
      done(null,chunk);
    }});
    await pipeline(Readable.fromWeb(download.body),verify,createWriteStream(temporary,{flags:'wx'}),{signal});
    if (size!==update.size || digest.digest('hex')!==update.hash) throw Error('更新包完整性校验失败。');
    await fs.rename(temporary,target);
  } finally {
    await fs.rm(temporary,{force:true});
  }
}

module.exports = {releasePage,chooseUpdate,checkUpdates,downloadUpdate};
