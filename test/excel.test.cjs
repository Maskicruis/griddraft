'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Excel=require('exceljs');
const {readExcel,analyzeExcel,mappingFor}=require('../src/excel.cjs');
const engine=require('../src/engine.cjs');
async function fixture(rows,headers=['工作编号','工作名称','工期(工日)','前置工作','后置工作','计划开始','计划完成','行类型','父工作编号']){
  const workbook=new Excel.Workbook(),sheet=workbook.addWorksheet('施工计划');
  sheet.addRows([headers,...rows]);return readExcel(await workbook.xlsx.writeBuffer(),'fixture.xlsx');
}
test('Excel imports original IDs, deduplicates reciprocal links and excludes explicit summaries',async()=>{
  const book=await fixture([['S','分项汇总',20,null,null,null,null,'汇总'],['10','准备',2,null,'20',new Date('2026-01-01'),null,'工序','S'],
    ['20','基础施工',7,'10','30FS+2工日',null,null,'工序','S'],['30','验收',1,'20FS+2工日',null,null,null,'工序','S']]);
  const result=analyzeExcel(book.sheets[0],undefined,book.name);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.summary.groups,1);assert.equal(result.graph.nodes.length,3);assert.equal(result.graph.edges.length,2);
  assert.equal(engine.cpm(result.graph).duration,12);
  assert.equal(result.records[1].start,'2026-01-01');
  const reopened=engine.normalize(JSON.parse(JSON.stringify(result.graph)));
  assert.deepEqual(reopened.importSource,result.graph.importSource);
  assert.equal(reopened.nodes[0].id,'10');
});
test('missing IDs and unsupported/truncated relations retain data and never produce an invented graph',async()=>{
  const book=await fixture([['基础施工',7,'207…'],['验收',1,'23SS+2工日']],['工作名称','工期(工日)','前置工作']);
  const result=analyzeExcel(book.sheets[0]);
  assert.equal(result.records.length,2);assert.equal(result.graph,null);
  assert.match(result.issues[0].message,/工作编号/);
  assert.equal(result.source.rows[0].cells[2],'207…');
  assert.ok(result.issues.some(issue=>/尚不支持/.test(issue.message)));
});
test('Excel rejects cycles, duplicate IDs, conflicting lag and invalid parent hierarchy',async()=>{
  for(const rows of [
    [['A','a',1,'B'],['B','b',1,'A']],
    [['A','a',1],['A','b',1]],
    [['A','a',1,null,'BFS+1'],['B','b',1,'AFS+2']],
    [['A','a',1,null,null,null,null,null,'B'],['B','b',1,null,null,null,null,null,'A']]
  ]){
    const book=await fixture(rows),result=analyzeExcel(book.sheets[0]);
    assert.equal(result.graph,null);assert.ok(result.issues.length);
  }
});
test('Excel finds headers beneath a title and reports cached-formula failures',async()=>{
  const wb=new Excel.Workbook(),sheet=wb.addWorksheet('表');
  sheet.addRows([['计划标题'],[],['工作编号','工作名称','工期'],['101','准备',{formula:'1+2'}]]);
  const book=await readExcel(await wb.xlsx.writeBuffer(),'example.xlsx');
  assert.equal(book.sheets[0].headerRow,3);
  const result=analyzeExcel(book.sheets[0]);
  assert.equal(result.graph,null);assert.ok(result.issues.some(issue=>/公式/.test(issue.message)));
  assert.equal(mappingFor(['工期（工日）']).duration,0);
});
test('the shipped namespaced XLSX template imports through the actual CLI',()=>{
  const {spawnSync}=require('node:child_process');
  const result=spawnSync(process.execPath,['bin/griddraft.cjs','import','examples/excel-plan.xlsx','--format','graph'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const graph=JSON.parse(result.stdout);
  assert.equal(graph.nodes.length,3);assert.equal(engine.cpm(graph).duration,12);
});
test('parent-only summaries may omit duration and IDs ending in FS are not misread as relation types',async()=>{
  const book=await fixture([['ROOT','父工作',null],['AFS','第一道',2,null,null,null,null,null,'ROOT'],['B','第二道',1,'AFS',null,null,null,null,'ROOT']]);
  const result=analyzeExcel(book.sheets[0]);
  assert.deepEqual(result.issues,[]);assert.equal(result.graph.nodes.length,2);
  assert.equal(engine.cpm(result.graph).duration,3);
});
