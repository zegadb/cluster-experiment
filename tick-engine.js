/* Simulator logical time. The protocol kernel remains independently testable at event granularity.
 * Start-of-tick inputs -> one bounded turn per process -> canonical commit -> future eligibility.
 * This is a visualization clock, not a distributed global barrier or physical CPU/network model.
 */
(function(root){
'use strict';
const K=CursorLab,copy=x=>JSON.parse(JSON.stringify(x)),own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const compare=(a,b)=>a<b?-1:a>b?1:0;
const hash=text=>{let h=2166136261;for(const ch of text)h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;};
const schedules=Object.freeze({...K.schedules,cfirst:'FIFO · C arrives sooner'});
const scheduleNotes=Object.freeze({
 fifo:'Network: one FIFO arrival per directed link per tick; one-tick latency. Every eligible cursor gets its own bounded turn.',
 lifo:'Network: newer eligible messages arrive first within each link; aging protects older messages. Cursor scheduling stays independent.',
 cfirst:'Network: FIFO links, latency to C=1, B=2, A=3, coordinator=1 ticks. Every eligible cursor still gets a turn.',
 delayed:'Network: result reports have 30-tick latency; control traffic has one. Workers can report and terminate while reports remain in transit.',
 duplicates:'Network: every logical message has one retry; result reports have 30-tick latency. Retry IDs and completion counts remain stable.',
 seeded:'Network: deterministic 1–4 tick latency, reorder and retries (seed 12648430). Cursor turns remain independent; aging protects older traffic. Fault injection also retries a bounded subset of local operation tokens.'
});
const key=q=>q.to==='coordinator'?'coordinator':q.to+'/'+(q.kind==='ack'?q.payload.parent:q.payload.cursor.id);
function delay(core,runtime,q){
 const override=runtime.delays[q.kind];
 if(override!==undefined)return override;
 if(['delayed','duplicates'].includes(core.schedule)&&q.kind==='result')return 30;
 if(core.schedule==='cfirst')return {C:1,B:2,A:3,coordinator:1}[q.to];
 if(core.schedule==='seeded')return 1+hash(q.id+':'+q.copy+':'+core.seed)%4;
 return 1;
}
function enroll(core,runtime,tick){
 for(const q of K.messages(core))if(!own(runtime.wires,q.wire)){
  const local=q.from===q.to;
  runtime.wires[q.wire]={sentAt:tick,eligibleAt:tick+(local?1:delay(core,runtime,q)),arrivedAt:local?tick:null,local};
  if(local){const address=key(q);(runtime.inboxes[address]||=[]).push(q.wire);}
 }
 for(const m of Object.values(core.machines))for(const task of m.ready)if(!own(runtime.tasks,task.ticket))runtime.tasks[task.ticket]=tick+1;
}
function create(scenario='chain',schedule='fifo',override,options={}){
 const core=K.create(scenario,schedule,override,options),runtime={tick:0,wires:{},tasks:{},inboxes:{},delays:copy(options.networkDelays||{}),trace:[],completedAt:null};
 for(const n of Object.values(runtime.delays))if(!Number.isInteger(n)||n<1||n>100)throw Error('Network delays must be integer simulator ticks from 1 to 100');
 enroll(core,runtime,0);
 return view(core,runtime,[],{type:'start',title:'Tick 0 · ready to start',detail:'Each Step advances simulator time. At tick start, eligible cursor/inbox turns and independent link arrivals are fixed. New work waits until the next tick.'});
}
function plan(s,options={}){
 const core=s.kernel,r=s.runtime,tick=r.tick+1,byActor=new Map(),queued=new Map(K.messages(core).map(q=>[q.wire,q]));
 function actor(id){if(!byActor.has(id))byActor.set(id,{id,tasks:[],inbox:[]});return byActor.get(id);}
 for(const m of Object.values(core.machines))for(const task of m.ready)if(r.tasks[task.ticket]<=tick)actor(m.id+'/'+task.cursor).tasks.push({...task,kind:'run',server:m.id,to:m.id});
 for(const [id,wires]of Object.entries(r.inboxes))for(const wire of wires){const q=queued.get(wire);if(q&&r.wires[wire].eligibleAt<=tick)actor(id).inbox.push(q);}
 // A decision reads only this process's frozen task/inbox input. Commit order is separate.
 let inputs=[...byActor.values()].sort((a,b)=>compare(a.id,b.id));
 if(options.turnOrder==='reverse')inputs.reverse();
 const turns=inputs.map(input=>{
  options.onDecision?.(input.id);
  input.tasks.sort((a,b)=>a.serial-b.serial);input.inbox.sort((a,b)=>r.wires[a.wire].arrivedAt-r.wires[b.wire].arrivedAt||a.serial-b.serial);
  const q=input.tasks[0]||input.inbox[0];
  return {actor:input.id,kind:q.kind==='run'?'operation':'receive',choice:q.ticket||q.wire,item:copy(q)};
 }).sort((a,b)=>compare(a.actor,b.actor));
 const links=[];
 for(const [linkId,link]of Object.entries(core.links)){
  const transit=link.queue.filter(q=>r.wires[q.wire].arrivedAt===null);
  const ready=transit.filter(q=>r.wires[q.wire].eligibleAt<=tick);if(!ready.length)continue;
  let q;
  if(['fifo','cfirst','delayed','duplicates'].includes(core.schedule)){
   // Delay-results schedules allow control traffic past deliberately delayed results.
   const lane=['delayed','duplicates'].includes(core.schedule)?transit.filter(q=>q.kind!=='result'):transit;
   const head=lane[0]||transit[0];if(r.wires[head.wire].eligibleAt<=tick)q=head;
  }else{
   const oldest=ready.reduce((a,b)=>a.serial<b.serial?a:b);
   if(tick-r.wires[oldest.wire].eligibleAt>=8)q=oldest;
   else if(core.schedule==='lifo')q=ready.at(-1);
   else q=ready.slice().sort((a,b)=>hash(a.wire+':'+tick+':'+core.seed)-hash(b.wire+':'+tick+':'+core.seed)||a.serial-b.serial)[0];
  }
  if(q)links.push({link:linkId,item:copy(q)});
 }
 links.sort((a,b)=>compare(a.link,b.link));
 return {tick,turns,arrivals:links};
}
function eventContext(before,after,e,q){
 const cursor=e.cursor||null,previous=cursor?before.cursors[cursor]:null,current=cursor?after.cursors[cursor]:null;
 const path=q?.payload?.path||q?.payload?.cursor?.path||(e.type==='follow'?previous?.path:current?.path)||[];
 return {before:previous?copy(previous):null,after:current?copy(current):null,path:copy(path),expected:after.control.expected,received:Object.keys(after.control.results).length};
}
function step(previous,options={}){
 if(previous.quiescent)return copy(previous);
 assertState(previous);
 const frozen=plan(previous,options),runtime=copy(previous.runtime);let core=copy(previous.kernel);const events=[];
 runtime.tick=frozen.tick;
 for(const turn of frozen.turns){
  const before=core,q=turn.item;core=K.step(core,turn.choice);
  if(turn.kind==='receive')runtime.inboxes[turn.actor]=runtime.inboxes[turn.actor].filter(wire=>wire!==turn.choice);
  const e={...copy(core.event),tick:frozen.tick,eventId:'event:'+core.tick,actor:turn.actor,turn:true,context:eventContext(before,core,core.event,q)};
  events.push(e);
 }
 for(const {link,item:q}of frozen.arrivals){
  runtime.wires[q.wire].arrivedAt=frozen.tick;runtime.wires[q.wire].eligibleAt=frozen.tick+1;
  const address=key(q);(runtime.inboxes[address]||=[]).push(q.wire);
  const cursor=q.to==='coordinator'?q.payload.cursor||'c1':q.kind==='ack'?q.payload.parent:q.payload.cursor.id;
  const e={type:'network',tick:frozen.tick,eventId:'arrival:'+q.wire,actor:address,turn:false,cursor,from:q.from,to:q.to,messageId:q.id,wire:q.wire,messageKind:q.kind,
   title:q.kind+' arrives in '+address+' inbox',detail:'Independent '+link+' delivery. This input can be consumed no earlier than tick '+(frozen.tick+1)+'. No cursor runs twice in this tick.',context:eventContext(core,core,{cursor},q)};
  events.push(e);
 }
 // Sends/spawns happened during this tick and were absent from its frozen plan.
 enroll(core,runtime,frozen.tick);
 runtime.trace.push(...events);
 if(core.complete&&runtime.completedAt===null)runtime.completedAt=frozen.tick;
 const workers=frozen.turns.filter(t=>t.actor!=='coordinator').length;
 const summary={type:'tick',title:'Tick '+frozen.tick+' · '+workers+' process turns · '+frozen.arrivals.length+' network arrivals',
  detail:(frozen.turns.some(t=>t.actor==='coordinator')?'Coordinator independently consumed a report. ':'')+(events.length?'All events in this tick are listed below. ':'Waiting for scheduled message eligibility. ')+
   'Every eligible cursor gets one bounded turn; new spawns, operations and messages wait for a later tick. Ticks are simulator time, not a production barrier or performance measurement.'};
 const result=view(core,runtime,events,summary);assertState(result);return result;
}
function view(core,runtime,events,event){
 const messages=K.messages(core),links={};
 for(const [id,link]of Object.entries(core.links))if(link.from!==link.to)links[id]={...link,queue:link.queue.filter(q=>runtime.wires[q.wire].arrivedAt===null).map(q=>({...q,eligibleAt:runtime.wires[q.wire].eligibleAt})),
  delivered:Object.values(runtime.wires).filter(w=>!w.local&&w.arrivedAt!==null&&messages.some(q=>q.wire===w.wire&&q.link===id)).length+link.delivered,
  recent:runtime.trace.filter(e=>e.type==='network'&&e.from===link.from&&e.to===link.to).slice(-5).map(e=>({tick:e.tick,kind:e.messageKind,id:e.messageId,duplicate:false}))};
 return {...core,kernel:core,runtime,tick:runtime.tick,completionTick:runtime.completedAt,events,history:runtime.trace,event,links,
  metrics:{...core.metrics,attemptsSent:Object.values(runtime.wires).filter(w=>!w.local).length,delivered:Object.values(runtime.wires).filter(w=>!w.local&&w.arrivedAt!==null).length,localMailboxAttempts:Object.values(runtime.wires).filter(w=>w.local).length,networkArrivals:Object.values(runtime.wires).filter(w=>!w.local&&w.arrivedAt!==null).length}};
}
function processes(s){
 const next=plan(s),ready=new Map(next.turns.map(t=>[t.actor,t]));
 return Object.values(s.cursors).map(c=>{
  const address=c.server+'/'+c.id,join=c.children.length>0,inbox=(s.runtime.inboxes[address]||[]).length,turn=ready.get(address);
  return {id:c.id,server:c.server,target:c.transitTo||null,node:c.path.at(-1),role:join?'join record':'worker',state:c.pc,
   status:c.pc==='done'?'terminated':turn?(turn.kind==='receive'?'ready to receive':'runnable: '+c.pc):c.pc==='wait'?'waiting for child counts':['route','dispatch','forwarded'].includes(c.pc)?'in flight':'blocked',inbox,ownCount:c.ownCount,joined:Object.keys(c.childCounts).length,children:c.children.length};
 });
}
function workItems(s){
 return K.workItems(s.kernel).map(q=>q.kind==='run'?{...q,eligibleAt:s.runtime.tasks[q.ticket]}:{...q,messageKind:q.kind,kind:s.runtime.wires[q.wire].arrivedAt===null?q.kind:'inbox',eligibleAt:s.runtime.wires[q.wire].eligibleAt});
}
function assertState(s){
 K.assertState(s.kernel);
 if(s.tick!==s.runtime.tick)throw Error('Invariant: logical tick mismatch');
 const pending=new Set(K.messages(s.kernel).map(q=>q.wire)),inboxes=Object.values(s.runtime.inboxes).flat();
 if(new Set(inboxes).size!==inboxes.length||inboxes.some(w=>!pending.has(w)||s.runtime.wires[w].arrivedAt===null))throw Error('Invariant: invalid process inbox');
 const actors=s.events.filter(e=>e.turn).map(e=>e.actor);if(new Set(actors).size!==actors.length)throw Error('Invariant: process received two turns in one tick');
 if(s.events.some(e=>e.tick!==s.tick))throw Error('Invariant: event belongs to another tick');
 return true;
}
function injectDuplicate(s,id,count=1){const core=K.injectDuplicate(s.kernel,id,count),runtime=copy(s.runtime);enroll(core,runtime,s.tick);return view(core,runtime,[],s.event);}
root.CursorTicks=Object.freeze({...K,schedules,scheduleNotes,create,step,plan,processes,workItems,assertState,injectDuplicate,
 messages:s=>Object.values(s.links).flatMap(l=>l.queue),pick:()=>-1,pending:s=>K.pending(s.kernel),active:s=>K.active(s.kernel),
 comparison:s=>K.comparison(s.kernel),coordinator:s=>K.coordinator(s.kernel),injectTaskDuplicate:(s,server,ticket)=>{const core=K.injectTaskDuplicate(s.kernel,server,ticket),r=copy(s.runtime);enroll(core,r,s.tick);return view(core,r,[],s.event);}});
})(typeof globalThis!=='undefined'?globalThis:this);
