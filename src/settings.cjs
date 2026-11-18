'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const defaults = { provider: 'deepseek', endpoint: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' };

function modelSettings(input) {
  if (!input || !['deepseek','compatible'].includes(input.provider)) throw Error('请选择模型服务。');
  const {provider} = input;
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 160 || /\s/.test(model)) throw Error('请填写服务商提供的模型 ID。');
  let url;
  try { url = new URL(input.endpoint); } catch { throw Error('请填写完整的 API 地址。'); }
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) {
    throw Error('API 地址须使用 HTTPS，且不含账号、密钥或查询参数。本地服务可使用 HTTP。');
  }
  let suffix = url.pathname.replace(/\/{2,}/g,'/').replace(/\/$/,'');
  if (provider === 'deepseek') {
    suffix = suffix.replace(/\/v1\/messages$/,'/v1');
    if (url.hostname === 'api.deepseek.com' && !suffix) suffix = '/anthropic';
  } else {
    suffix = suffix.replace(/\/chat\/completions$/,'');
    if (!suffix && ['api.siliconflow.cn','api.siliconflow.com'].includes(url.hostname)) suffix = '/v1';
  }
  return {provider, endpoint:url.origin+suffix, model};
}

function createModelStore(directory, encryption) {
  const file = path.join(directory,'model-settings.json');
  async function read() {
    try {
      const raw = JSON.parse(await fs.readFile(file,'utf8'));
      return {...modelSettings(raw), encryptedKey:typeof raw.encryptedKey === 'string' ? raw.encryptedKey : ''};
    } catch (error) {
      if (error.code === 'ENOENT') return {...defaults, encryptedKey:''};
      throw Error('无法读取模型配置。保存新设置可重新创建配置。');
    }
  }
  function summarize({provider,endpoint,model,encryptedKey}) {
    return {provider,endpoint,model,hasKey:Boolean(encryptedKey)};
  }
  async function storedKey(data, next) {
    if (data.provider !== next.provider || data.endpoint !== next.endpoint) return '';
    if (!data.encryptedKey) return '';
    try { return (await encryption.decryptStringAsync(Buffer.from(data.encryptedKey,'base64'))).result; }
    catch { throw Error('无法解密原密钥，请重新填写。'); }
  }
  function inputKey(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (key.length > 1024 || /[^\x21-\x7e]/.test(key)) throw Error('API 密钥格式无效。');
    return key;
  }
  return {
    async settings() { return summarize(await read()); },
    async credentials() {
      const saved = await read();
      return {...modelSettings(saved), key:await storedKey(saved,saved)};
    },
    async candidate(form) {
      const next = modelSettings(form);
      const key = inputKey(form.key) || (form.removeKey ? '' : await storedKey(await read(),next));
      return {...next,key};
    },
    async save(form) {
      const next = modelSettings(form);
      const key = inputKey(form.key);
      let encryptedKey = '';
      if (key) {
        if (!await encryption.isAsyncEncryptionAvailable() || encryption.getSelectedStorageBackend?.() === 'basic_text') {
          throw Error('系统安全存储不可用，无法保存 API 密钥。');
        }
        encryptedKey = (await encryption.encryptStringAsync(key)).toString('base64');
      } else if (!form.removeKey) {
        const previous = await read().catch(() => ({encryptedKey:''}));
        if (previous.provider === next.provider && previous.endpoint === next.endpoint) encryptedKey = previous.encryptedKey;
      }
      const saved = {...next,encryptedKey};
      const pending = file+'.'+randomUUID()+'.tmp';
      await fs.mkdir(directory,{recursive:true});
      try {
        await fs.writeFile(pending,JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o600});
        await fs.rename(pending,file);
      } finally {
        await fs.rm(pending,{force:true});
      }
      return summarize(saved);
    }
  };
}

module.exports = {createModelStore,modelSettings};
