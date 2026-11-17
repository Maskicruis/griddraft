'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {render,normalize,cpm}=require('./engine.cjs');
const {buildNetwork,renderNetwork}=require('./aoa.cjs');
async function draw(){
  const {graph,options}=workerData;
  if(!options.networkView)return render(graph,options);
  const network=buildNetwork(graph);
  return {graph:normalize(graph),network,analysis:cpm(graph),svg:renderNetwork(network,{view:options.networkView})};
}
draw().then(result=>parentPort.postMessage({result}),
  error=>parentPort.postMessage({error:error.message,code:error.code}));
