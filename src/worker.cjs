'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {render}=require('./engine.cjs');
render(workerData.graph,workerData.options).then(result=>parentPort.postMessage({result}),
  error=>parentPort.postMessage({error:error.message,code:error.code}));
