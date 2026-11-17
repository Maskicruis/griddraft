#!/usr/bin/env node
'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const engine=require('../src/engine.cjs');
const {buildNetwork,renderNetwork}=require('../src/aoa.cjs');
const version=require('../package.json').version;
const MAX=32*1024*1024;
const help=`GridDraft ${version}
  griddraft validate <input.json | ->
  griddraft layout <input.json | -> [--direction RIGHT|DOWN|LEFT|UP] [--out file]
  griddraft render <input.json | -> [--critical] [--out file.svg]
  griddraft cpm <input.json | -> [--out file]
  griddraft edit <input.json | -> --patch operations.json [--out file]
  griddraft network <input.json | -> [--format svg|json] [--view time|logic] [--out file]
  griddraft batch <directory> --out <directory> [--format svg|layout|cpm|network] [--view time|logic] [--critical]

JSON and SVG data go to stdout when --out is omitted. Errors are JSON on stderr.
Exit codes: 0 success, 1 operation failed, 2 usage error, 3 batch completed with failures.
Use '-' to read JSON from stdin.
`;

const usage=message=>Object.assign(new Error(message),{code:'USAGE'});
function parse(args,allowed){
  const flags={},pos=[];
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(!a.startsWith('--')){pos.push(a);continue;}
    if(!allowed.includes(a)||Object.hasOwn(flags,a))throw usage('不支持或重复的选项 '+a);
    if(a==='--critical'){flags[a]=true;continue;}
    if(!args[i+1]||args[i+1].startsWith('--'))throw usage(a+' 需要参数。');
    flags[a]=args[++i];
  }
  if(pos.length!==1)throw usage('需要一个输入文件或目录。');
  return {input:pos[0],flags};
}
function json(value){return JSON.stringify(value,null,2)+'\n';}
function status(error){return {code:error.code||'FAILED',message:error.message};}
async function read(input){
  let raw;
  if(input==='-'){
    const chunks=[];let bytes=0;
    for await(const piece of process.stdin){
      bytes+=piece.length;
      if(bytes>MAX)throw new engine.GraphError('INPUT_TOO_LARGE','输入超过 32 MiB。');
      chunks.push(piece);
    }
    raw=Buffer.concat(chunks).toString('utf8');
  }else{
    const st=await fs.stat(input);
    if(!st.isFile())throw new engine.GraphError('NOT_FILE','输入须为普通文件。');
    if(st.size>MAX)throw new engine.GraphError('INPUT_TOO_LARGE','输入超过 32 MiB。');
    raw=await fs.readFile(input,'utf8');
  }
  try{return JSON.parse(raw.replace(/^\uFEFF/,''));}
  catch(e){throw new engine.GraphError('INVALID_JSON',e.message);}
}
async function write(out,contents){
  if(!out||out==='-'){process.stdout.write(contents);return;}
  const temporary=out+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,contents,{encoding:'utf8',flag:'wx'});
  try{await fs.rename(temporary,out);}
  finally{await fs.rm(temporary,{force:true});}
}
async function batch(input,flags){
  if(!flags['--out']||flags['--out']==='-'||input==='-')throw usage('batch 需要输入和输出目录。');
  const format=flags['--format']||'svg';
  if(!['svg','layout','cpm','network'].includes(format)||flags['--critical']&&format!=='svg'||
    flags['--view']&&format!=='network')throw usage('批处理格式或选项无效。');
  if(flags['--view']&&!['time','logic'].includes(flags['--view']))throw usage('视图须为 time 或 logic。');
  const entries=await fs.readdir(input,{withFileTypes:true});
  const files=entries.filter(e=>e.isFile()&&/\.json$/i.test(e.name)).map(e=>e.name).sort();
  await fs.mkdir(flags['--out'],{recursive:true});
  const a=await fs.realpath(input), b=await fs.realpath(flags['--out']);
  if((process.platform==='win32'?a.toLowerCase():a)===(process.platform==='win32'?b.toLowerCase():b))
    throw usage('批处理的输入、输出目录必须不同。');
  const items=[], outputs=new Set();
  for(const file of files){
    const name=file.replace(/\.json$/i,format==='svg'?'.svg':format==='network'?'.network.svg':'.'+format+'.json');
    try{
      const key=process.platform==='win32'?name.toLowerCase():name;
      if(outputs.has(key))throw new engine.GraphError('OUTPUT_COLLISION','批次内输出文件名冲突。');
      outputs.add(key);
      const graph=await read(path.join(a,file));
      const content=format==='network'?renderNetwork(buildNetwork(graph),{view:flags['--view']}):
        format==='svg'?(await engine.render(graph,{critical:flags['--critical']})).svg:
          json(format==='layout'?await engine.layout(graph):engine.cpm(graph));
      await write(path.join(b,name),content);
      items.push({input:file,ok:true,output:name});
    }catch(error){items.push({input:file,ok:false,error:status(error)});}
  }
  const failures=items.filter(v=>!v.ok).length;
  process.stdout.write(json({version:1, processed:items.length, failures,items}));
  return failures?3:0;
}
async function main(args){
  const command=args.shift();
  if(!command||command==='--help'||command==='help'){process.stdout.write(help);return 0;}
  if(command==='--version'){process.stdout.write(version+'\n');return 0;}
  const choices={validate:[],layout:['--direction','--out'],render:['--critical','--out'],
    cpm:['--out'],edit:['--patch','--out'],network:['--format','--view','--out'],batch:['--out','--format','--critical','--view']};
  if(!Object.hasOwn(choices,command))throw usage('未知命令 '+command);
  const {input,flags}=parse(args,choices[command]);
  if(command==='batch')return batch(input,flags);
  const graph=await read(input);
  let result;
  if(command==='validate'){
    const g=engine.normalize(graph);
    result={ok:true,version:g.version,nodes:g.nodes.length,edges:g.edges.length};
  }else if(command==='layout')result=await engine.layout(graph,{direction:flags['--direction']});
  else if(command==='render')result=(await engine.render(graph,{critical:flags['--critical']})).svg;
  else if(command==='cpm')result=engine.cpm(graph);
  else if(command==='network'){
    const format=flags['--format']||'svg';
    if(!['svg','json'].includes(format)||flags['--view']&&!['time','logic'].includes(flags['--view']))
      throw usage('网络图格式须为 svg 或 json，视图须为 time 或 logic。');
    const network=buildNetwork(graph);
    result=format==='json'?network:renderNetwork(network,{view:flags['--view']});
  }
  else {
    if(!flags['--patch']||flags['--patch']==='-')throw usage('edit 需要 --patch operations.json。');
    result=engine.edit(graph,await read(flags['--patch']));
  }
  await write(flags['--out'],typeof result==='string'?result+'\n':json(result));
  return 0;
}

main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{
  process.stderr.write(json({ok:false,error:status(error)}));
  process.exitCode=error.code==='USAGE'?2:1;
});
