'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({});for(const f of ['engine.js','tick-engine.js','queries.js','timeline.js','tick-timeline.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
const T=ctx.CursorTicks,Q=ctx.CursorQueries,L=ctx.CursorTimeline,plain=x=>JSON.parse(JSON.stringify(x));let groups=0,runs=0,ticks=0,events=0;
const native=JSON.parse(fs.readFileSync(__dirname+'/verified-zql-responses.json','utf8')).cases;
function test(name,fn){fn();groups++;console.log('PASS Tick '+name);}
function run(s,trace){runs++;let guard=0;while(!s.quiescent){assert(guard++<1000,'eventual delivery');const previous=s,frozen=T.plan(s);s=T.step(s);assert.equal(s.events.filter(e=>e.turn).length,frozen.turns.length);assert.equal(s.events.filter(e=>e.type==='network').length,frozen.arrivals.length);ticks++;events+=s.events.length;T.assertState(s);assert.equal(s.tick,previous.tick+1);assert.equal(new Set(s.events.filter(e=>e.turn).map(e=>e.actor)).size,s.events.filter(e=>e.turn).length);if(s.complete)assert(T.comparison(s).passed);if(trace)trace.push(s);}assert(s.complete);assert(T.comparison(s).passed);return s;}
const completed={};
for(const scenario of Object.keys(T.scenarios))for(const schedule of Object.keys(T.schedules))test(scenario+'/'+schedule+' · finite delivery, exact counts, selected JSON and invariants',()=>{
 const trace=[],final=run(T.create(scenario,schedule),trace);assert.deepEqual(plain(Q.project(final.data,final.control)),native[scenario].response);completed[scenario+'/'+schedule]={trace,final};
});
test('every process gets one independent bounded turn, including two workers on the same owner',()=>{
 const record=completed['movies/fifo'].trace.find(s=>s.events.some(e=>e.type==='emit'&&e.cursor==='c1.4'));
 assert(record.events.some(e=>e.type==='emit'&&e.cursor==='c1.5'));
 const fork=completed['movies/fifo'].trace.find(s=>s.events.some(e=>e.type==='fork'));
 assert.equal(T.processes(fork).filter(p=>p.role==='worker').length,5);assert.equal(T.processes(fork).filter(p=>p.role==='join record').length,1);
 const ready=completed['movies/fifo'].trace.find(s=>s.events.some(e=>e.actor==='B/c1.1'&&e.turn)&&s.events.some(e=>e.actor==='B/c1.4'&&e.turn));assert(ready);
});
test('local movie reports and terminates while all four remote branches are still delayed',()=>{
 const trace=[],final=run(T.create('movies','fifo',undefined,{networkDelays:{transfer:12}}),trace);
 const emitted=trace.find(s=>s.events.some(e=>e.type==='emit'&&e.cursor==='c1.3'));
 const received=trace.find(s=>s.events.some(e=>e.type==='result'&&e.cursor==='c1.3'));
 const ended=trace.find(s=>s.events.some(e=>e.type==='finish'&&e.cursor==='c1.3'));
 assert.equal(emitted.tick,6);assert.equal(received.tick,8);assert.equal(ended.tick,8);
 assert.equal(T.messages(received).filter(q=>q.kind==='transfer').length,4);assert.equal(received.control.expected,null);assert(!received.complete);
 assert.equal(final.control.expected,5);assert.equal(final.received.length,5);
 fs.writeFileSync(__dirname+'/tick-walkthrough.txt',['Movie processes · transfer latency 12 simulator ticks; no real timing claim.',...trace.map(s=>'Tick '+s.tick+' | '+s.events.map(e=>e.title).join(' ; ')+' | results='+s.received.length+' / '+(s.control.expected??'?')+' | complete='+s.complete)].join('\n')+'\n');
});
test('spawn, operation continuations, network sends and received inbox inputs wait until a later tick',()=>{
 for(const {trace}of Object.values(completed))for(const s of trace){
  for(const e of s.events){
   if(e.type==='fork'){const children=e.context.after.children;assert(!s.events.some(x=>x.turn&&children.includes(x.cursor)));}
   if(e.type==='network'){assert(!s.events.some(x=>x.turn&&x.wire===e.wire));assert(s.runtime.wires[e.wire].eligibleAt>s.tick);}
  }
  for(const q of T.messages(s))assert(s.runtime.wires[q.wire].eligibleAt>s.runtime.wires[q.wire].sentAt);
  for(const m of Object.values(s.machines))for(const task of m.ready)assert(s.runtime.tasks[task.ticket]>=1);
 }
});
test('within-tick decision enumeration order has no effect on committed states or future scheduling',()=>{
 for(const scenario of Object.keys(T.scenarios))for(const schedule of ['fifo','seeded']){
  let a=T.create(scenario,schedule),b=T.create(scenario,schedule),multi=0;
  while(!a.quiescent){const forward=[],reverse=[];a=T.step(a,{onDecision:id=>forward.push(id)});b=T.step(b,{turnOrder:'reverse',onDecision:id=>reverse.push(id)});assert.deepEqual(forward,reverse.slice().reverse());if(forward.length>1)multi++;assert.equal(JSON.stringify(a),JSON.stringify(b));}
  if(!['chain','empty'].includes(scenario))assert(multi>0);
 }
});
test('rootDone can arrive first; coordinator waits for unique result receipts rather than visible queues or final row count',()=>{
 const {trace,final}=completed['chain/delayed'];const root=trace.find(s=>s.control.expected!==null);assert(root.received.length<2);assert(!root.complete);assert.equal(final.control.expected,2);
 const city=completed['restaurants/delayed'];const pending=city.trace.find(s=>s.control.expected===55&&!s.complete);assert(pending);assert.equal(city.final.received.length,55);assert.equal(Q.project(city.final.data,city.final.control).length,5);
});
test('duplicate results/ACKs/transfers/tasks cannot execute or count twice; late retries drain after completion',()=>{
 const final=completed['movies/duplicates'].final;for(const kind of ['result','ack','transfer','dispatch','rootDone'])assert(final.kernel.metrics.ignored[kind]>0,kind);
 const id=Object.keys(final.logical).find(id=>id.includes(':result:'));
 let s=T.injectDuplicate(final,id,3);assert(s.complete&&!s.quiescent);s=run(s);assert.equal(s.received.length,5);assert.equal(s.control.expected,5);
 assert(completed['movies/seeded'].final.kernel.metrics.ignored.run>0);
});
test('local completion uses a process mailbox and does not consume a physical network delivery slot',()=>{
 const {trace}=completed['movies/fifo'];const finished=trace.find(s=>s.events.some(e=>e.type==='finish'&&e.cursor==='c1.3'));
 assert(finished.runtime.inboxes['A/c1'].length>0);assert(!Object.keys(finished.links).includes('A → A'));
 assert(!trace.flatMap(s=>s.events).some(e=>e.type==='network'&&e.from===e.to));
});
test('reset/replay, immutable prior snapshots and exact query projection remain deterministic',()=>{
 for(const scenario of Object.keys(T.scenarios)){
  let s=T.create(scenario,'seeded'),initial=JSON.stringify(s);for(const recorded of completed[scenario+'/seeded'].trace){s=T.step(s);assert.equal(JSON.stringify(s),JSON.stringify(recorded));}
  assert.equal(JSON.stringify(T.create(scenario,'seeded')),initial);assert.equal(JSON.stringify(T.step(s)),JSON.stringify(s));
 }
});
test('120 additional deterministic seeded schedules, including domain plans',()=>{
 for(let seed=1;seed<=20;seed++)for(const scenario of ['chain','branch','diamond','wide','movies','empty'])run(T.create(scenario,'seeded',undefined,{seed}));
});
test('40 generated cyclic graphs preserve bounded walks and completion under tick scheduling',()=>{
 let seed=31337;const random=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n;};
 for(let i=0;i<40;i++){const nodes=Array.from({length:3+random(3)},(_,j)=>({id:'n'+j,name:'Node '+j,owner:['A','B','C'][random(3)]})),edges=[];for(const n of nodes){const degree=random(3),targets=new Set();while(targets.size<degree)targets.add(nodes[random(nodes.length)].id);for(const b of targets)edges.push([n.id,b]);}run(T.create('generated','seeded',{name:'generated',description:'fixed seeded input',start:'n0',maxHops:random(4),nodes,edges},{seed:i+1}));}
});
test('timeline includes every event within a tick, worker/join lanes and no future snapshot leakage',()=>{
 const records=[T.create('movies','fifo'),...completed['movies/fifo'].trace],end=records.at(-1),model=L.project(records,end.tick);
 assert.equal(model.events.length,1+end.runtime.trace.length);assert.equal(model.lanes.length,6);assert.equal(model.lanes.filter(l=>l.current.role==='join record').length,1);assert.equal(model.forks.length,5);assert.equal(model.joins.length,5);
 const fork=records.find(s=>s.events.some(e=>e.type==='fork')),past=L.project(records,fork.tick-1);assert.equal(past.lanes.length,1);assert(!past.events.some(e=>e.type==='fork'));
 const poison=new Proxy({tick:999999},{get(o,k){if(k!=='tick')throw Error('Future payload read');return o[k];}});assert.equal(L.project([...records,poison],fork.tick-1).currentTick,fork.tick-1);
 const emission=model.events.find(e=>e.type==='emit'&&e.cursor==='c1.3');assert.equal(L.project(records,end.tick,emission.eventId).selected.tick,6);
});
const {harness}=require('./ui-harness.cjs');
test('production UI Step/Back/Play/Reset and event selection share one recorded tick history',()=>{
 const h=harness(),{elements:el,click,state}=h;el.scenario.value='movies';el.scenario.handlers.change();for(let i=0;i<8;i++)click('step');assert.equal(state().tick,8);assert.equal(state().received.length,1);assert(el.stepLabel.textContent.startsWith('TICK 08'));assert(el.liveProcesses.innerHTML.includes('c1.3'));assert(el.joinRecords.innerHTML.includes('join record'));assert(state().events.length>1);
 assert.equal((el.tickEvents.innerHTML.match(/data-tick-event=/g)||[]).length,state().events.length);
 const saved=JSON.stringify(state());click('back');assert.equal(state().tick,7);click('step');assert.equal(JSON.stringify(state()),saved);
 const e=state().events.find(e=>e.type==='emit');el.tickEvents.handlers.click({target:{closest:()=>({dataset:{tickEvent:e.eventId,cursor:e.cursor}})}});assert.equal(state().tick,8);assert.equal(h.timeline().selected.eventId,e.eventId);
 click('play');assert.equal(state().tick,9);h.playTick();assert.equal(state().tick,10);click('play');el.timeline.value='4';el.timeline.handlers.input();assert.equal(state().tick,4);assert.equal(h.timeline().lanes.length,6);
 click('reset');assert.equal(state().tick,0);assert.equal(h.sandbox.window.CursorLabUI.getRecordedCount(),1);assert(!el.fatal.textContent);
});
console.log('\n'+groups+' tick test groups passed. '+runs+' completed tick protocol runs; '+ticks+' ticks and '+events+' events checked in the run harness.');
console.log('All elapsed units are simulator ticks. No physical parallelism, global production barrier, throughput or fault-tolerance claim.');
