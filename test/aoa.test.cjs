'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { cpm } = require('../src/engine.cjs');
const { buildNetwork, renderNetwork } = require('../src/aoa.cjs');
const fuyu = require('../examples/fuyu-demo.json');

function successors(edges) {
  const next = new Map();
  for (const {from, to} of edges) {
    if (!next.has(from)) next.set(from, []);
    next.get(from).push(to);
  }
  return next;
}

function canReach(next, from, to) {
  const seen = new Set(), remaining = [from];
  while (remaining.length) {
    const here = remaining.pop();
    if (here === to) return true;
    if (seen.has(here)) continue;
    seen.add(here);
    remaining.push(...(next.get(here) || []));
  }
  return false;
}

test('the Fuyu example produces a unique start and finish, dummy work and 34-day critical route', () => {
  const network = buildNetwork(fuyu);
  assert.equal(network.duration, 34);
  assert.equal(network.kind, 'activity-on-arrow');
  assert.deepEqual(network.arrows.filter(a => a.kind === 'activity' && a.critical).map(a => a.activityId), ['RD','F08-P','F08-B','CL-L']);
  assert.ok(network.arrows.some(a => a.kind === 'dummy' && a.gapAtHead > 0));
  const output = renderNetwork(network);
  assert.match(output, /双代号时标网络图/);
  assert.match(output, /D34/);
  assert.match(output, /stroke-dasharray=/);
  assert.match(output, /data-kind="activity" data-critical="true"/);
  assert.match(output, / Q[\d.]+ /);
  assert.equal(output, renderNetwork(buildNetwork(fuyu)));
  assert.doesNotMatch(renderNetwork(network,{view:'logic'}), />D34<| Q[\d.]+ /);
});

test('converted networks preserve reachability and CPM across merged and parallel paths', () => {
  let seed = 64;
  const random = max => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed >>> 8) % max;
  };
  for (let sample = 0; sample < 70; sample++) {
    const nodes = Array.from({length:9}, (_,i) => {
      const kind = random(5) === 0 ? 'milestone' : 'task';
      return {id:'T'+i,label:'工序 '+i,kind,duration:kind==='milestone'?0:random(8)};
    });
    const edges = [];
    for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
      if (random(4)===0) edges.push({id:'L'+i+'-'+j,from:nodes[i].id,to:nodes[j].id,lag:random(4)});
    }
    const graph = {version:1,title:'测试 '+sample,nodes,edges};
    const network = buildNetwork(graph);
    const from = successors(edges), to = successors(network.arrows);
    const work = network.arrows.filter(a => a.kind==='activity');
    assert.equal(network.duration, cpm(graph).duration);
    assert.equal(new Set(network.arrows.map(a => a.from+'-'+a.to)).size,network.arrows.length);
    for (const event of network.events) {
      assert.ok(canReach(to,network.start,event.id));
      assert.ok(canReach(to,event.id,network.finish));
    }
    assert.ok(network.arrows.every(a => a.from<a.to));
    for (const a of work) for (const b of work) {
      if(a===b) continue;
      assert.equal(canReach(to,a.to,b.from),canReach(from,a.activityId,b.activityId),`sample ${sample}, ${a.activityId} → ${b.activityId}`);
    }
  }
});
