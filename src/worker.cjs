'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {render,normalize,cpm}=require('./engine.cjs');
const {buildNetwork,renderNetwork}=require('./aoa.cjs');
const {unitGraph}=require('./project.cjs');
const {buildSummary,renderSummary}=require('./summary.cjs');
async function draw(){
  const {graph,options}=workerData;
  const source=normalize(graph),visible=options.unit?unitGraph(source,options.unit):source;
  if(['summary','auto'].includes(options.networkView)&&!options.unit){
    const summary=buildSummary(source);
    if(options.networkView==='summary'||summary.repeatedGroups)
      return {graph:source,summary,analysis:cpm(source),svg:await renderSummary(summary,{animated:options.animated,embedMotionStyle:false})};
  }
  if(!options.networkView){
    const result=await render(visible,options);
    if(options.unit){
      const {edit}=require('./engine.cjs');
      result.graph=edit(source,result.graph.nodes.map(node=>({op:'put-node',node})));
    }
    return result;
  }
  const network=buildNetwork(visible);
  return {graph:source,network,analysis:cpm(visible),svg:renderNetwork(network,{view:options.networkView==='auto'?'logic':options.networkView,viewport:options.viewport,animated:options.animated,embedMotionStyle:false})};
}
draw().then(result=>parentPort.postMessage({result}),
  error=>parentPort.postMessage({error:error.message,code:error.code}));
