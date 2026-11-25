'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {render,normalize,cpm}=require('./engine.cjs');
const {buildNetwork,renderNetwork}=require('./aoa.cjs');
const {unitGraph}=require('./project.cjs');
async function draw(){
  const {graph,options}=workerData;
  const source=normalize(graph),visible=options.unit?unitGraph(source,options.unit):source;
  if(!options.networkView){
    const result=await render(visible,options);
    if(options.unit){
      const {edit}=require('./engine.cjs');
      result.graph=edit(source,result.graph.nodes.map(node=>({op:'put-node',node})));
    }
    return result;
  }
  const network=buildNetwork(visible);
  return {graph:source,network,analysis:cpm(visible),svg:renderNetwork(network,{view:options.networkView})};
}
draw().then(result=>parentPort.postMessage({result}),
  error=>parentPort.postMessage({error:error.message,code:error.code}));
