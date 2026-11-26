'use strict';
const {parentPort,workerData}=require('node:worker_threads');
require('./excel.cjs').readExcel(workerData.bytes,workerData.name).then(result=>parentPort.postMessage({result}),
  error=>parentPort.postMessage({error:error.message,code:error.code}));
