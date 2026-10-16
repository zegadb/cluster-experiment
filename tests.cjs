'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const dir=__dirname;
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const engine=html.match(/<script id="simulation-engine">([\s\S]*?)<\/script>/)[1].trim();
assert.equal(engine,fs.readFileSync(path.join(dir,'engine.js'),'utf8').trim(),'Embedded engine must match source');
const ctx=vm.createContext({});vm.runInContext(engine,ctx);const E=ctx.CursorLab;
const timelineSource=html.match(/<script id="execution-timeline">([\s\S]*?)<\/script>/)[1].trim();
assert.equal(timelineSource,fs.readFileSync(path.join(dir,'timeline.js'),'utf8').trim(),'Embedded timeline must match source');
vm.runInContext(timelineSource,ctx);const T=ctx.CursorTimeline;
const legacyScenarios=['chain','branch','diamond','wide','empty'];
const querySource=fs.readFileSync(path.join(dir,'queries.js'),'utf8');vm.runInContext(querySource,ctx);
const plain=x=>JSON.parse(JSON.stringify(x));
const verifiedResponses=JSON.parse(fs.readFileSync(path.join(dir,'verified-zql-responses.json'),'utf8')).cases;
let passed=0,runs=0,transitions=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name);throw e;}}
const completed={};
function run(initial,trace){
 let s=initial,guard=0;const expected=E.reference(s.data);runs++;
 while(!s.quiescent){
  if(guard++>3000)throw Error('Eventual delivery failed to terminate');
  s=E.step(s);transitions++;
  assert.equal(s.complete,E.queryComplete(s.control));
  if(s.complete){assert(E.comparison(s).passed,'Coordinator completed before exact reference output');assert.equal(s.control.expected,expected.count);}
  if(trace)trace.push(s);
 }
 assert(s.complete);assert(E.comparison(s).passed);assert.equal(s.control.expected,expected.count);
 return s;
}
const expected={chain:[2,2],branch:[3,3],diamond:[3,8],wide:[5,5],empty:[0,0]};
for(const scenario of legacyScenarios)for(const schedule of Object.keys(E.schedules)){
 test(scenario+' / '+schedule+' · reference, subtree count, no early completion and eventual delivery',()=>{
  const steps=[],result=run(E.create(scenario,schedule),steps);
  assert.equal(result.distinct.length,expected[scenario][0]);assert.equal(result.received.length,expected[scenario][1]);
  assert.equal(result.cursors.c1.total,expected[scenario][1]);completed[scenario+'/'+schedule]={steps,result};
 });
}
test('Completion function is coordinator-local even when queues/servers are inaccessible',()=>{
 const control={expected:2,results:{one:{}},distinct:['same-person'],queryId:'q',rootId:'c1',startOwner:'A',deliveries:1,duplicateResults:0,duplicateRoots:0};
 const proxy=new Proxy({control},{get(o,k){if(k!=='control')throw Error('Global visibility attempted: '+String(k));return o[k];}});
 assert.equal(E.coordinator(proxy).complete,false);
 control.results.two={};assert.equal(E.coordinator(proxy).complete,true);
 control.expected=null;assert.equal(E.queryComplete(control),false);
 control.expected=0;control.results={};assert.equal(E.queryComplete(control),true);
});
test('Delayed chain: rootDone arrives with expected=2, received=0; two receipts are required',()=>{
 const {steps,result}=completed['chain/delayed'];
 const root=steps.find(s=>s.event.messageKind==='rootDone');
 assert.equal(root.control.expected,2);assert.equal(root.received.length,0);assert(!root.complete);
 assert.equal(E.messages(root).filter(q=>q.kind==='result').length,2);
 const after=steps.filter(s=>s.tick>=root.tick);
 assert.equal(after[1].received.length,1);assert(!after[1].complete);
 assert.equal(after[2].received.length,2);assert(after[2].complete);
 assert.equal(result.completionTick,after[2].tick);
 const report=['REAL STEP TRACE · chain / Delay results','Completion reads only control.expected and control.results.',...after.map(s=>'Step '+s.tick+' | '+s.event.title+' | expected='+s.control.expected+' | unique='+s.received.length+' | done='+s.complete+' | '+E.coordinator(s).reason)];
 fs.writeFileSync(path.join(dir,'protocol-walkthrough.txt'),report.join('\n')+'\n');
});
test('Query can complete with retry traffic still queued, then safely drain it',()=>{
 const {steps,result}=completed['branch/duplicates'];
 const first=steps.find(s=>s.complete);assert(!first.quiescent);assert(E.messages(first).length>0);
 assert(E.pending(first)>0);assert(E.comparison(first).passed);
 assert(result.tick>result.completionTick);assert(result.quiescent);
});
test('Duplicate results, child acknowledgements, transfers, dispatch and rootDone are idempotent',()=>{
 const r=completed['wide/duplicates'].result;
 for(const k of ['result','ack','transfer','dispatch','rootDone'])assert(r.metrics.ignored[k]>0,k);
 assert.equal(r.control.expected,5);assert.equal(r.received.length,5);
 assert.equal(new Set(r.received.map(x=>x.resultId)).size,5);
 for(const c of Object.values(r.cursors))if(c.pc==='done')assert.equal(c.total,c.ownCount+Object.values(c.childCounts).reduce((a,b)=>a+b,0));
});
test('Old cursor retry cannot roll back a later legitimate return to the same server',()=>{
 const data=plain(E.scenarios.chain);data.maxHops=4;data.edges=[['ava','ben'],['ben','cleo'],['cleo','ava']];
 let s=run(E.create('returning','delayed',data));
 assert.equal(s.cursors.c1.server,'B');assert.equal(s.cursors.c1.generation,4);assert.equal(s.received.length,3);
 const old=Object.values(s.logical).find(q=>q.kind==='transfer'&&q.to==='B'&&q.payload.cursor.generation===1);
 const before=JSON.stringify(s.machines.B.cursors.c1);s=E.injectDuplicate(s,old.id,3);s=run(s);
 assert.equal(JSON.stringify(s.machines.B.cursors.c1),before);assert.equal(s.metrics.ignored.transfer,3);
});
test('Duplicate operation token cannot emit twice; later operation on same cursor executes',()=>{
 let s=E.step(E.create('chain','fifo'));
 const first=s.machines.A.ready[0];s=E.injectTaskDuplicate(s,'A',first.ticket);
 s=E.step(s,first.ticket);assert.equal(s.machines.A.cursors.c1.pc,'expand');
 const duplicate=s.machines.A.ready.find(t=>t.id===first.id);s=E.step(s,duplicate.ticket);
 assert.equal(s.metrics.ignored.run,1);assert.equal(s.machines.A.cursors.c1.pc,'expand');
 s=run(s);assert.equal(s.received.length,2);assert.equal(s.control.expected,2);
});
test('Fork seals/registers final child set atomically before children can report',()=>{
 for(const {steps}of Object.values(completed))for(const s of steps)if(s.event.type==='fork'){
  const c=s.cursors[s.event.cursor];assert(c.sealed);assert.equal(c.pc,'wait');assert(c.children.length>1);assert.equal(Object.keys(c.childCounts).length,0);
  for(const q of E.messages(s))if(q.kind==='transfer'&&q.payload.cursor.parent===c.id)assert(c.children.includes(q.payload.cursor.id));
 }
});
test('Parent completion requires local work sealed and every child count, including zero',()=>{
 const data=plain(E.scenarios.branch);data.maxHops=0;const zero=run(E.create('zero','duplicates',data));assert.equal(zero.control.expected,0);
 const childZero=plain(E.scenarios.branch);childZero.maxHops=1;childZero.edges=[['ava','ava'],['ava','ben']];
 const joined=run(E.create('zero-child','duplicates',childZero));assert.equal(joined.control.expected,1);
 assert.equal(joined.cursors.c1.childCounts['c1.1'],0);assert.equal(joined.cursors.c1.childCounts['c1.2'],1);
 for(const {steps}of Object.values(completed))for(const s of steps)for(const m of Object.values(s.machines))for(const c of Object.values(m.cursors))if(c.pc==='done'){
  assert(c.sealed);assert.deepEqual(Object.keys(c.childCounts).sort(),plain(c.children).sort());
 }
 const bad=plain(completed['branch/fifo'].steps.find(s=>s.event.type==='fork'));
 const c=bad.machines.A.cursors.c1;c.pc='done';c.total=0;
 assert.throws(()=>E.assertState(bad),/parent finished/);
});
test('Transfers preserve path, parent address and own result count without adding depth',()=>{
 for(const {steps}of Object.values(completed))for(const s of steps)if(s.event.type==='transfer'&&s.event.messageKind==='transfer'){
  const q=s.logical[s.event.messageId],sent=q.payload.cursor,accepted=s.machines[q.to].cursors[sent.id];
  assert.deepEqual(plain(accepted.path),plain(sent.path));assert.equal(accepted.parent,sent.parent);assert.equal(accepted.parentServer,sent.parentServer);
  assert.equal(accepted.ownCount,sent.ownCount);assert.equal(accepted.generation,sent.generation);
 }
});
test('FIFO schedules always deliver link heads; local task queues have independent heads',()=>{
 for(const scenario of legacyScenarios)for(const schedule of ['fifo','cfirst']){
  let s=E.create(scenario,schedule);while(!s.quiescent){const q=E.workItems(s)[E.pick(s)];if(q.kind==='run')assert.equal(s.machines[q.server].ready[0].ticket,q.ticket);else assert.equal(s.links[q.link].queue[0].wire,q.wire);s=E.step(s);}
 }
});
test('Reordering really permits a later same-link message before the earlier result',()=>{
 const {steps}=completed['chain/delayed'];const s=steps.find(s=>s.event.messageKind==='rootDone');
 const sameLink=s.links[s.event.from+' → coordinator'];assert(sameLink.queue.some(q=>q.kind==='result'));
});
test('Walk paths stay distinct through diamonds and cycles; only output people deduplicate',()=>{
 const r=completed['diamond/duplicates'].result;
 assert.equal(r.received.filter(x=>x.node==='dee').length,2);
 assert.equal(r.received.filter(x=>x.node==='ben').length,3);assert.equal(r.received.filter(x=>x.node==='cleo').length,3);
 assert(!r.distinct.includes('ava'));assert(r.received.every(x=>x.path.length-1<=4));
 assert.equal(new Set(r.received.map(x=>x.resultId)).size,8);assert.equal(r.control.expected,8);
});
test('Zero-depth and empty-neighbor cases terminate with exactly zero expected results',()=>{
 for(const schedule of Object.keys(E.schedules)){
  const d=plain(E.scenarios.diamond);d.maxHops=0;const s=run(E.create('zero',schedule,d));assert.equal(s.control.expected,0);assert.equal(s.received.length,0);assert.equal(s.transfers,0);
 }
});
test('Reset/replay and transitions preserve snapshots deterministically',()=>{
 for(const scenario of legacyScenarios)for(const schedule of Object.keys(E.schedules)){
  const initial=E.create(scenario,schedule),before=JSON.stringify(initial);let s=initial;
  for(const recorded of completed[scenario+'/'+schedule].steps){s=E.step(s);assert.equal(JSON.stringify(s),JSON.stringify(recorded));}
  assert.equal(JSON.stringify(initial),before);assert.equal(JSON.stringify(E.step(s)),JSON.stringify(s));
 }
});
test('Static fixtures remain deeply immutable',()=>{
 assert(Object.isFrozen(E.scenarios.diamond.edges[0]));assert.throws(()=>{E.scenarios.chain.maxHops=55;});
});
test('Coordinator snapshot is independent of transport metrics and observer projections',()=>{
 const s=completed['chain/delayed'].steps.find(s=>s.control.expected===2&&!s.complete),a=E.coordinator(s),copy=plain(s);
 copy.links={};copy.machines={};copy.cursors={};copy.metrics={anything:'irrelevant'};assert.deepEqual(plain(E.coordinator(copy)),plain(a));
});
test('All emitted result IDs remain identical under each delivery schedule',()=>{
 for(const scenario of legacyScenarios){
  const ids=Object.keys(completed[scenario+'/fifo'].result.control.results).sort();
  for(const schedule of Object.keys(E.schedules))assert.deepEqual(plain(Object.keys(completed[scenario+'/'+schedule].result.control.results).sort()),plain(ids));
 }
});
test('500 seeded randomized delivery/retry runs on the five fixed graphs',()=>{
 for(let seed=1;seed<=100;seed++)for(const scenario of legacyScenarios)run(E.create(scenario,'seeded',undefined,{seed}));
});
test('100 seeded random graphs: cycles, self-links, varying owners/bounds and empty outputs',()=>{
 let randomState=77891;const rng=n=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return(randomState>>>0)%n;};
 for(let trial=0;trial<100;trial++){
  const nodes=Array.from({length:3+rng(4)},(_,i)=>({id:'p'+i,name:i?'Person'+i:'Ava',owner:['A','B','C'][rng(3)]}));
  const edges=[];for(const n of nodes){const degree=rng(3),targets=new Set();while(targets.size<degree)targets.add(nodes[rng(nodes.length)].id);for(const to of targets)edges.push([n.id,to]);}
  const data={name:'random',description:'seeded fixture',start:'p0',maxHops:rng(5),nodes,edges};
  run(E.create('random','seeded',data,{seed:trial+334}));
 }
});

const {harness}=require('./ui-harness.cjs');
test('UI: Step, Back, forward replay, Reset, Play/Pause and floating clearance',()=>{
 const h=harness(),{elements:el,click,state}=h;assert.equal(state().tick,0);click('step');const before=JSON.stringify(state());click('back');assert.equal(state().tick,0);click('step');assert.equal(JSON.stringify(state()),before);
 click('reset');assert.equal(state().tick,0);click('play');assert.equal(el.play.textContent,'Ⅱ Pause');click('play');assert.equal(el.play.textContent,'▶ Play');
 assert.equal(h.styles['--playback-reserve'],'112px');el.playbackControls.height=156.2;h.resize();assert.equal(h.styles['--playback-reserve'],'189px');
 for(const id of ['back','step','play','reset','stepLabel'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
});
test('UI: all 30 graph/schedule runs display true counts, link traffic, local state and oracle',()=>{
 const h=harness(),{elements:el,click,state}=h;
 for(const scenario of legacyScenarios)for(const schedule of Object.keys(E.schedules)){
  el.scenario.value=scenario;el.schedule.value=schedule;click('reset');let guard=0;
  while(!state().quiescent){click('step');if(guard++>3000)throw Error('UI failed to drain');const s=state(),c=E.coordinator(s);
   assert.equal(el.coordWhy.textContent,c.reason);assert.equal(el.coordInboxSummary.textContent,c.receivedResults+' / '+(c.expected===null?'?':c.expected)+' unique results');
   assert(el.linkQueues.innerHTML.includes('data-directed-link='));assert.equal((el.serverStates.innerHTML.match(/<h4>Server [ABC]<\/h4>/g)||[]).length,3);
   assert.equal(el.coordResultLabel.textContent,s.complete?'Final joined result:':'Partial result:');
   const response=JSON.parse(el.results.textContent);
   assert.deepEqual(Object.keys(response),['follows']);assert(Array.isArray(response.follows));assert(response.follows.every(row=>JSON.stringify(Object.keys(row))==='["name"]'));
   const receivedIds=[...new Set(Object.values(s.control.results).map(r=>r.node))];
   assert.deepEqual(response.follows.map(row=>row.name).sort(),receivedIds.map(id=>s.data.nodes.find(n=>n.id===id).name).sort());
   if(s.complete)assert.deepEqual(response,verifiedResponses[scenario].response);
   assert.equal(el.userResponseState.textContent,s.complete?'Final ZQL response':'Partial ZQL response · assembled from received results');
   const timeline=h.timeline();assert.equal(timeline.currentTick,s.tick);assert.equal(timeline.events.length,s.tick+1);assert(timeline.events.every(e=>e.tick<=s.tick));
   assert(el.executionGraph.innerHTML.includes('data-visible-step="'+s.tick+'"'));assert(el.executionEventHeading.textContent.startsWith('Step '+s.tick+' · '));
   assert(el.verification.innerHTML.includes('Oracle expected:'));assert(el.graphAll&&el.graphA&&el.graphB&&el.graphC);
   if(s.complete&&!s.quiescent)assert(!el.step.disabled,'Late retries remain demonstrable');
  }
  assert(el.step.disabled);assert(el.verification.innerHTML.includes('PASS'));assert(!el.fatal.textContent);
 }
 click('checks');assert(el.checkReport.textContent.includes('42 / 42 reference checks passed'));

});
test('UI: ZQL, safe string rendering and semantic gap survive protocol changes',()=>{
 const h=harness(),{elements:el,click}=h;
 el.scenario.value='diamond';click('reset');assert(el.coordQuery.textContent.includes('follows *1..4 -> Person(name != "Ava") { name }'));
 assert(el.coordQueryGap.textContent.includes('does not return those path records'));assert.equal(el.coordQuery.innerHTML,'');
 const d=plain(E.scenarios.chain);d.nodes[0].name='Ava "A" \\ <b>&friend</b>\n\t';const q=h.sandbox.window.CursorLabUI.queryText(d);
 assert(q.includes('\\"A\\"'));assert(q.includes('\\\\'));assert(q.includes('\\n\\t'));assert(/\$\('coordQuery'\)\.textContent\s*=\s*queryText\(s.data\)/.test(html));
 assert(html.indexOf('id="coordQuery"')<html.indexOf('id="coordinatorServer"'));
});
test('HTML is self-contained; every ID is unique; coordinator receipt view has no transport dependency',()=>{
 assert(!/<script[^>]+src\s*=/.test(html));assert(!/<link[^>]+href\s*=/.test(html));assert(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(engine+querySource+fs.readFileSync(path.join(dir,'ui.js'),'utf8')));
 const markup=html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);
});
function timelineRecords(scenario,schedule){return[E.create(scenario,schedule),...completed[scenario+'/'+schedule].steps];}
test('Timeline: transfers keep one continuous cursor lane and never create forks',()=>{
 const records=timelineRecords('chain','fifo'),model=T.project(records,records.at(-1).tick);
 assert.deepEqual(plain(model.lanes.map(l=>l.id)),['c1']);assert.equal(model.forks.length,0);assert.equal(model.joins.length,0);
 assert.equal(model.events.filter(e=>e.type==='transfer').length,2);assert.equal(model.events.filter(e=>e.type==='transfer-send').length,2);
 assert(model.lanes[0].segments.some(s=>s.style==='inflight'));
 assert(model.lanes[0].segments.some(s=>s.server==='A'));assert(model.lanes[0].segments.some(s=>s.server==='B'));assert(model.lanes[0].segments.some(s=>s.server==='C'));
});
test('Timeline: actual forks alone introduce child lanes at their recorded birth step',()=>{
 const records=timelineRecords('branch','fifo'),fork=records.find(s=>s.event.type==='fork');
 const before=T.project(records,fork.tick-1),after=T.project(records,fork.tick);
 assert.equal(before.lanes.length,1);assert.equal(before.forks.length,0);assert.equal(after.lanes.length,3);
 assert.deepEqual(plain(after.forks.map(f=>f.child)),plain(fork.cursors.c1.children));
 assert(after.forks.every(f=>f.tick===fork.tick&&f.parent==='c1'));
 const full=T.project(records,records.at(-1).tick);assert(full.lanes.find(l=>l.id==='c1').segments.some(s=>s.style==='waiting'));
});
test('Timeline: ACK joins use actual child finish/receipt steps and unique subtree counts',()=>{
 const records=timelineRecords('wide','duplicates'),model=T.project(records,records.at(-1).tick);
 const actual=records.filter(s=>s.event.type==='join');assert.equal(model.joins.length,actual.length);
 for(const join of model.joins){const source=records.find(s=>s.tick===join.sourceTick),receipt=records.find(s=>s.tick===join.tick),payload=receipt.logical[receipt.event.messageId].payload;
  assert.equal(source.event.type,'finish');assert.equal(source.event.cursor,join.child);assert.equal(payload.parent,join.parent);assert.equal(payload.count,join.count);assert(join.sourceTick<join.tick);
 }
 assert(model.events.some(e=>e.marker==='duplicate'&&e.messageKind==='ack'));
 assert.equal(model.joins.length,4,'Duplicate ACKs do not produce another join');
});
test('Timeline: diamond convergence stays on separate walk lanes rather than merging nodes',()=>{
 const records=timelineRecords('diamond','fifo'),model=T.project(records,records.at(-1).tick);
 const dee=model.events.filter(e=>e.type==='read'&&e.node==='dee');assert.equal(dee.length,2);assert.notEqual(dee[0].lane,dee[1].lane);
 assert(dee.every(e=>e.depth===2));assert(model.joins.every(j=>j.parent===model.lanes.find(l=>l.id===j.child).parent));
 assert.equal(model.lanes.length,7);assert.equal(model.forks.length,6);
});
test('Timeline: emissions and ignored retries have separate markers without duplicate execution lanes',()=>{
 const records=timelineRecords('diamond','duplicates'),model=T.project(records,records.at(-1).tick);
 assert.equal(model.events.filter(e=>e.marker==='emission').length,8);
 const copies=model.events.filter(e=>e.marker==='duplicate');assert(copies.some(e=>e.messageKind==='result'));assert(copies.some(e=>e.messageKind==='transfer'));assert(copies.some(e=>e.messageKind==='ack'));
 assert(copies.filter(e=>e.messageKind==='result').every(e=>e.lane==='@coordinator'));
 assert.equal(model.lanes.length,T.project(timelineRecords('diamond','fifo'),completed['diamond/fifo'].result.tick).lanes.length);
 assert(model.lanes.some(l=>l.segments.some(s=>s.style==='messages')),'Late traffic has a messages-only guide after execution ends');
});
test('Timeline: backward projection hides future forks, joins, markers and state values',()=>{
 const records=timelineRecords('branch','duplicates'),fork=records.find(s=>s.event.type==='fork');
 const old=T.project(records,fork.tick-1);assert.equal(old.lanes.length,1);assert.equal(old.forks.length,0);assert.equal(old.joins.length,0);
 assert(old.events.every(e=>e.tick<fork.tick));assert(old.lanes.every(l=>l.segments.every(s=>s.end<fork.tick)));
 const poison=new Proxy({tick:99999},{get(o,key){if(key!=='tick')throw Error('Future payload was read');return o[key];}});
 assert.equal(T.project([...records,poison],fork.tick-1).currentTick,fork.tick-1);
 const atFork=T.project(records,fork.tick),context=atFork.selected;assert.equal(Object.keys(context.childCounts).length,0);assert.equal(context.children.length,2);
});
test('Timeline: selected event context uses event-time node/server/depth/counts and is read-only',()=>{
 const records=timelineRecords('chain','seeded'),before=JSON.stringify(records),model=T.project(records,records.at(-1).tick);
 const emission=model.events.find(e=>e.type==='emit');assert.equal(emission.server,'B');assert.equal(emission.node,'ben');assert.equal(emission.depth,1);assert.equal(emission.ownCount,1);
 for(const retry of model.events.filter(e=>e.type==='duplicate'&&e.messageKind==='run')){const first=model.events.find(e=>e.executionId===retry.messageId);assert(first);assert.equal(retry.server,first.server);assert.equal(retry.node,first.node);assert.equal(retry.depth,first.depth);}
 model.data.nodes[0].name='output mutation';model.lanes[0].current.childCounts.fake=999;
 assert.equal(JSON.stringify(records),before);
});
test('Timeline UI: marker click/keyboard, Step, Back, slider, Play and Reset share recorded state',()=>{
 const h=harness(),{elements:el,click,state}=h;el.scenario.value='branch';el.schedule.value='duplicates';click('reset');
 while(!state().quiescent)click('step');const recorded=h.sandbox.window.CursorLabUI.getRecordedCount();
 const choose=(tick,key)=>{const target={closest:()=>({dataset:{executionStep:String(tick)}})};if(key)el.executionGraph.handlers.keydown({target,key,preventDefault(){}});else el.executionGraph.handlers.click({target});};
 choose(2);assert.equal(state().tick,2);assert.equal(h.timeline().currentTick,2);assert.equal(h.timeline().lanes.length,1);assert(el.executionEventHeading.textContent.startsWith('Step 2 · '));
 assert.equal(h.sandbox.window.CursorLabUI.getRecordedCount(),recorded,'Timeline navigation does not run a second simulation');
 choose(3);assert.equal(state().tick,2,'Forged future marker cannot reveal a future recorded event');
 click('step');assert.equal(state().tick,3);assert.equal(h.timeline().currentTick,3);click('back');assert.equal(h.timeline().currentTick,2);
 choose(1,'Enter');assert.equal(state().tick,1);click('play');assert.equal(h.timeline().currentTick,2);h.playTick();assert.equal(h.timeline().currentTick,3);click('play');
 el.timeline.value='0';el.timeline.handlers.input();assert.equal(h.timeline().currentTick,0);assert.equal(h.timeline().events.length,1);
 click('reset');assert.equal(h.timeline().currentTick,0);assert.equal(h.sandbox.window.CursorLabUI.getRecordedCount(),1);
});
test('Timeline UI: additive view preserves existing panels, oracle outputs and literal details',()=>{
 const h=harness(),{elements:el,click,state}=h;el.scenario.value='wide';el.schedule.value='duplicates';click('reset');
 while(!state().quiescent)click('step');assert(E.comparison(state()).passed);
 for(const id of ['graphAll','graphA','graphB','graphC','coordinatorServer','linkQueues','serverStates','verification','coordQuery','playbackControls','history','queue','inspector','pathList'])assert(el[id]);
 const before=JSON.stringify(state()),model=h.timeline();model.data.nodes[0].name='not the input';assert.equal(JSON.stringify(state()),before);
 assert(el.executionGraph.innerHTML.includes('data-timeline-kind="ack-join"'));assert(el.executionGraph.innerHTML.includes('data-marker="duplicate"'));assert(el.executionGraph.innerHTML.includes('role="button" tabindex="0"'));
 assert.equal(el.executionDescription.innerHTML,'');assert(!el.fatal.textContent);
 fs.writeFileSync(path.join(dir,'test-execution-timeline.svg'),el.executionGraph.innerHTML);
});
test('ZQL response: rootDone before arrivals cannot reveal data; exact partial and final selected fields',()=>{
 const h=harness(),{elements:el,click,state}=h;el.schedule.value='delayed';click('reset');
 assert.deepEqual(JSON.parse(el.results.textContent),{follows:[]});
 while(state().control.expected===null)click('step');assert.equal(state().control.expected,2);assert.deepEqual(JSON.parse(el.results.textContent),{follows:[]});
 click('step');assert.deepEqual(JSON.parse(el.results.textContent),{follows:[{name:'Cleo'}]});assert(el.responseUpdateLabel.textContent.includes('updated'));assert(el.responseChangeDetail.textContent.includes('Cleo'));
 click('step');assert(state().complete);assert.deepEqual(JSON.parse(el.results.textContent),verifiedResponses.chain.response);
 click('back');assert.deepEqual(JSON.parse(el.results.textContent),{follows:[{name:'Cleo'}]});assert(el.responseUpdateLabel.textContent.includes('updated'));
 el.timeline.value='15';el.timeline.handlers.input();assert.deepEqual(JSON.parse(el.results.textContent),{follows:[]});
 click('reset');assert.equal(state().tick,0);assert(el.responseUpdateLabel.textContent.includes('No return-data'));
});
test('ZQL response: diamond path and retry receipts do not multiply distinct user rows',()=>{
 const h=harness(),{elements:el,click,state}=h;el.scenario.value='diamond';el.schedule.value='duplicates';click('reset');let duplicates=0,extraPaths=0;
 while(!state().quiescent){const before=el.results.textContent;click('step');const s=state();if(s.event.type==='duplicate'&&s.event.messageKind==='result'){duplicates++;assert.equal(el.results.textContent,before);assert(!el.userResponsePanel.classes.has('response-updated'));}if(s.event.type==='result'&&before===el.results.textContent){extraPaths++;assert(!el.responseConnector.classes.has('is-active'));}}
 assert.equal(duplicates,8);assert(extraPaths>0);assert.equal(state().received.length,8);assert.deepEqual(JSON.parse(el.results.textContent),verifiedResponses.diamond.response);
 el.scenario.value='empty';click('reset');while(!state().quiescent)click('step');assert.deepEqual(JSON.parse(el.results.textContent),{follows:[]});
});
test('ZQL response: literal selected values, node identity, deterministic order and receipt-only state',()=>{
 const h=harness(),Q=h.sandbox.CursorQueries;
 for(const scenario of legacyScenarios)for(const schedule of Object.keys(E.schedules)){
  const c=completed[scenario+'/'+schedule].result.control,localOnly=new Proxy({results:c.results},{get(o,k){if(k!=='results')throw Error('Non-receipt field read: '+String(k));return o[k];}});
  assert.deepEqual(plain(Q.project(E.scenarios[scenario],localOnly)),verifiedResponses[scenario].response);
 }
 const data=plain(E.scenarios.chain);data.nodes[1].name='Ben "B" \\\ <b>&friend</b>\n\t';const hostile=harness(data);while(!hostile.state().quiescent)hostile.click('step');
 assert.equal(JSON.parse(hostile.elements.results.textContent).follows[0].name,data.nodes[1].name);assert.equal(hostile.elements.results.innerHTML,'');
 assert(!/\$\('results'\)\.innerHTML\s*=/.test(html));
 const fixture={start:'a',maxHops:1,nodes:[{id:'a',name:'A',owner:'A'},{id:'b',name:'Same',owner:'B'},{id:'c',name:'Same',owner:'C'}],edges:[['a','b'],['a','c']]};let r=run(E.create('same','fifo',fixture));
 assert.deepEqual(plain(Q.project(fixture,r.control)),{follows:[{name:'Same'},{name:'Same'}]});
});
test('Floating scenario selection has one accessible instance and resets current execution/reference',()=>{
 const h=harness(),{elements:el,click,state}=h;assert.equal((html.match(/id="scenario"/g)||[]).length,1);assert(html.indexOf('id="scenario"')>html.indexOf('id="playbackControls"'));
 click('step');el.scenario.value='movies';el.scenario.handlers.change();assert.equal(state().tick,0);assert.equal(state().scenario,'movies');assert.equal(h.sandbox.window.CursorLabUI.getReference().status,'not-run');assert.equal(el.runZega.disabled,false);
});
for(const scenario of ['movies','restaurants'])for(const schedule of Object.keys(E.schedules))test('Domain plan: '+scenario+' / '+schedule,()=>{
 const r=run(E.create(scenario,schedule));assert.equal(r.received.length,scenario==='movies'?5:55);assert.equal(r.control.expected,r.received.length);
 assert.deepEqual(plain(ctx.CursorQueries.project(r.data,r.control)),verifiedResponses[scenario].response);
 assert(r.received.every(x=>x.row));
});
test('Movie owner reads project only five linked movies; restaurant scan contains 55 real nodes',()=>{
 assert.equal(E.scenarios.movies.nodes.filter(n=>n.kind==='Movie').length,10);assert.equal(E.scenarios.restaurants.nodes.length,55);
 const r=run(E.create('movies','duplicates'));assert.deepEqual(plain(r.received.map(x=>x.node).sort()),['movie1','movie2','movie3','movie4','movie5']);
 const d=run(E.create('restaurants','delayed'));assert.equal(d.received.filter(x=>x.role==='City').length,5);assert.equal(d.received.filter(x=>x.role==='Restaurant').length,50);assert(d.received.filter(x=>x.role==='City').every(x=>x.expectedCandidates===10));
});
test('Domain UI: all fixtures render selected response and timeline without future response data',()=>{
 for(const scenario of ['movies','restaurants']){const h=harness(),{elements:el,click,state}=h;el.scenario.value=scenario;el.schedule.value='delayed';click('reset');let limit=0;
  while(!state().quiescent){click('step');if(limit++>3000)throw Error('Domain UI stuck');assert(!el.fatal.textContent);}
  assert.deepEqual(JSON.parse(el.results.textContent),verifiedResponses[scenario].response);assert.equal(h.timeline().currentTick,state().tick);assert.equal(el.wasmStatus.textContent,'Not run for this fixture and query');assert(!el.wasmComparison.textContent.includes('MATCH'));
 }
});
module.exports={harness,E,plain,html};
console.log('\n'+passed+' test groups passed. '+runs+' completed protocol runs, '+transitions+' transitions in the oracle-checked run harness.');
console.log('Coverage: 30 fixed graph/schedule cases; 500 seeded delivery/retry cases; 100 seeded generated graph cases; targeted adversarial/regression/UI cases.');
console.log('Timeline coverage: transfers versus forks, ACK count joins, independent converging walks, retry/emission markers, event-time context, no future leakage, shared navigation/playback, and preserved panels.');
console.log('Selected response coverage: exact WASM-verified shape/order, partial receipts, duplicate paths, safe literals, response-change cues, domain projections and scenario invalidation.');
console.log('Every step checks invariants. At the first coordinator-local completion, exact paths and distinct output must already match the independent DFS oracle.');
console.log('These finite tests are evidence, not a formal proof of every possible execution.');
console.log('\nFixed scenario outcomes:');
for(const scenario of legacyScenarios){const r=completed[scenario+'/duplicates'].result;console.log(scenario+': '+r.distinct.length+' people / '+r.received.length+' unique result messages; retries schedule query completes at '+r.completionTick+', traffic drains at '+r.tick+'.');}
console.log('\nReal-browser layout/console/screenshot verification is blocked by the prior file-URL policy denial; DOM harness checks are not visual QA.');
