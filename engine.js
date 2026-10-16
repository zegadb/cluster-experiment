/* Pure deterministic state machine. No DOM, timers, networking, or mutable data. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  function freeze(value) {
    Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); });
    return Object.freeze(value);
  }
  const servers = freeze({ A: { name: 'Server A', color: '#167d9a' }, B: { name: 'Server B', color: '#a76718' }, C: { name: 'Server C', color: '#7956b3' } });
  const scenarioData = {
    chain: {
      name: '01 · Cross-server chain', start: 'ava', maxHops: 2,
      description: 'One cursor follows Ava → Ben → Cleo across all three servers. Dax is beyond the hop bound.',
      nodes: [{ id: 'ava', name: 'Ava', owner: 'A' }, { id: 'ben', name: 'Ben', owner: 'B' }, { id: 'cleo', name: 'Cleo', owner: 'C' }, { id: 'dax', name: 'Dax', owner: 'C' }],
      edges: [['ava', 'ben'], ['ben', 'cleo'], ['cleo', 'dax']]
    },
    branch: {
      name: '02 · Fork, finish, join', start: 'ava', maxHops: 2,
      description: 'Ben is a short local branch. Cleo continues to Dina on another server. Try another delivery order.',
      nodes: [{ id: 'ava', name: 'Ava', owner: 'A' }, { id: 'ben', name: 'Ben', owner: 'A' }, { id: 'cleo', name: 'Cleo', owner: 'B' }, { id: 'dina', name: 'Dina', owner: 'C' }],
      edges: [['ava', 'ben'], ['ava', 'cleo'], ['cleo', 'dina']]
    },
    diamond: {
      name: '03 · Diamond + bounded cycle', start: 'ava', maxHops: 4,
      description: 'Ben and Cleo both reach Dee. Dee follows Ava, closing a cycle. Both paths survive; the walk stops at four hops.',
      nodes: [{ id: 'ava', name: 'Ava', owner: 'A' }, { id: 'dee', name: 'Dee', owner: 'A' }, { id: 'ben', name: 'Ben', owner: 'B' }, { id: 'cleo', name: 'Cleo', owner: 'C' }],
      edges: [['ava', 'ben'], ['ava', 'cleo'], ['ben', 'dee'], ['cleo', 'dee'], ['dee', 'ava']]
    }
  };
  const movieNodes=Array.from({length:10},(_,i)=>({id:'movie'+(i+1),name:['Copper Horizon','Glass Atlas','Signal Harbor','Winter Circuit','Amber Relay','Lunar Ledger','Paper Orbit','Silent Compass','Velvet Engine','Northbound Light'][i],title:['Copper Horizon','Glass Atlas','Signal Harbor','Winter Circuit','Amber Relay','Lunar Ledger','Paper Orbit','Silent Compass','Velvet Engine','Northbound Light'][i],year:2010+i,kind:'Movie',owner:['B','C','A'][i%3]}));
  const cities=['Alder Bay','Briar Falls','Cedar Vale','Dawn Harbor','Elm Ridge'];
  const cityNodes=cities.map((name,i)=>({id:'city'+i,name,kind:'City',owner:['A','B','C'][i%3]}));
  const restaurants=cityNodes.flatMap((city,c)=>Array.from({length:10},(_,i)=>({id:'r'+c+'_'+i,name:city.name+' '+['Juniper','Lantern','Saffron','Orchard','Ember','Willow','Basil','Meadow','Copper','Pearl'][i],rating:c===0&&(i===2||i===9)?4.9:Math.round((3.5+((c*11+i*7)%15)/10)*10)/10,kind:'Restaurant',owner:['A','B','C'][(c+i)%3]})));
  const scenarios = freeze({ chain:scenarioData.chain,
    movies:{name:'02 · Actor → five movies',queryKind:'movies',start:'rdj',maxHops:1,description:'Ten fictional movies. Robert Downey Jr. connects to five across three owners; five connected to another actor are excluded.',nodes:[{id:'rdj',name:'Robert Downey Jr.',kind:'Actor',owner:'A'},{id:'other',name:'Morgan Vale (fictional)',kind:'Actor',owner:'B'},...movieNodes],edges:movieNodes.map((n,i)=>[i<5?'rdj':'other',n.id])},
    restaurants:{name:'03 · Five cities / 50 restaurants',queryKind:'restaurants',start:'@cities',maxHops:2,description:'Five fictional cities each connect to ten restaurants. A collection scan forks by city, then gathers ten candidates per city before ranking. Return the top rating; name then creation ID break ties.',nodes:[...cityNodes,...restaurants],edges:restaurants.map(n=>['city'+n.id.slice(1).split('_')[0],n.id])},
    branch:{...scenarioData.branch,name:'Advanced · Fork, finish, join'},diamond:{...scenarioData.diamond,name:'Advanced · Diamond + bounded cycle'},
    wide: { name: '04 · Three-server branching', start: 'ava', maxHops: 2,
      description: 'Ava forks to B and C; Cleo forks again. Five unique path results join through two parent servers.',
      nodes: [{id:'ava',name:'Ava',owner:'A'},{id:'fay',name:'Fay',owner:'A'},{id:'ben',name:'Ben',owner:'B'},{id:'eli',name:'Eli',owner:'B'},{id:'cleo',name:'Cleo',owner:'C'},{id:'dee',name:'Dee',owner:'C'}],
      edges: [['ava','ben'],['ava','cleo'],['ben','dee'],['cleo','eli'],['cleo','fay']] },
    empty: { name: '05 · Empty result', start: 'ava', maxHops: 2,
      description: 'Ava has no outgoing follows. rootDone carries zero; the coordinator can finish with no results.',
      nodes: [{id:'ava',name:'Ava',owner:'A'},{id:'ben',name:'Ben',owner:'B'},{id:'cleo',name:'Cleo',owner:'C'}], edges: [] }
  });
  const schedules = freeze({ fifo: 'FIFO links', lifo: 'Reorder: newest first', cfirst: 'FIFO: server C first', delayed: 'Delay results', duplicates: 'Retries + delayed results', seeded: 'Seeded reorder + retries' });
  const scheduleNotes = freeze({
    fifo: 'Each directed link delivers in FIFO order. Local server tasks also run in FIFO order.',
    cfirst: 'FIFO within each link; delivery destinations C, B, A then coordinator are prioritized.',
    lifo: 'Deliberately reorder within links and local queues: newest pending item first.',
    delayed: 'Reorder within links and postpone result messages until all available non-result work runs. rootDone can arrive first.',
    duplicates: 'Every logical network/mailbox message is copied once with the same ID. Results are delayed; late retries remain step-through after query completion.',
    seeded: 'Seed 12648430 chooses a reproducible order; a deterministic subset of messages and local tasks is retried once.'
  });
  const node = (data, id) => id==='@cities'?{id,name:'Scan all cities',owner:'A',kind:'Scan'}:data.nodes.find(n => n.id === id);
  const outgoing = (data,id) => id==='@cities'?data.nodes.filter(n=>n.kind==='City').map(n=>n.id):data.edges.filter(([from])=>from===id).map(([,to])=>to);
  const names = (data, path) => path.map(id => node(data, id).name).join(' → ');
  const token = path => path.join('/');
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const runnable = c => ['visit','emit','expand','route','finish'].includes(c.pc);
  const sum = values => values.reduce((a,b) => a+b, 0);
  const hash = text => { let h=2166136261; for (const ch of text) h=Math.imul(h^ch.charCodeAt(0),16777619); return h>>>0; };
  const random = seed => { let x=seed||1; x^=x<<13; x^=x>>>17; x^=x<<5; return x>>>0; };
  const executionId = c => c.id + '/g' + c.generation + '/op' + c.op;
  function cursor(id, parent, path, server, generation=0) {
    return { id, parent, parentServer:null, path:path.slice(), server, generation, op:0, pc:'visit',
      ownCount:0, emitted:[], children:[], childCounts:{}, acknowledged:[], sealed:false, total:null };
  }
  // THE completion predicate. Its only input is coordinator-local receipt state.
  function queryComplete(control) {
    return control.expected !== null && Object.keys(control.results).length === control.expected;
  }
  function coordinatorReason(control) {
    if (control.expected === null) return 'Waiting for rootDone. The coordinator does not know the final result-message count yet.';
    const received=Object.keys(control.results).length, missing=control.expected-received;
    return missing ? 'rootDone promised ' + control.expected + ' unique result messages; ' + received + ' received, ' + missing + ' still missing.' :
      'Done: rootDone promised ' + control.expected + ' unique result messages and all ' + received + ' have arrived. Queue visibility is not used.';
  }
  const messages = s => Object.values(s.links).flatMap(link => link.queue).sort((a,b)=>a.serial-b.serial);
  function workItems(s) {
    return [...messages(s), ...Object.values(s.machines).flatMap(m => m.ready.map(task => ({...task,kind:'run',server:m.id,to:m.id})))].sort((a,b)=>a.serial-b.serial);
  }
  const active = s => Object.values(s.machines).flatMap(m=>Object.values(m.cursors)).filter(runnable);
  // Observer metric only. Never called by queryComplete or any protocol decision.
  const pending = s => active(s).length + messages(s).length;
  const target = (s, item) => item.to;
  function pick(s) {
    const items=workItems(s);
    if (!items.length) return -1;
    if (s.schedule === 'seeded') return random(s.rng)%items.length;
    if (s.schedule === 'lifo') return items.length-1;
    if (['delayed','duplicates'].includes(s.schedule)) {
      for (let i=items.length-1;i>=0;i--) if (items[i].kind!=='result') return i;
      return items.length-1;
    }
    if (s.schedule === 'cfirst') {
      const rank={C:0,B:1,A:2,coordinator:3};
      // Only link/server heads are eligible under FIFO schedules.
      const heads=items.map((q,i)=>({q,i})).filter(({q})=>q.kind==='run' ? s.machines[q.server].ready[0].ticket===q.ticket : s.links[q.link].queue[0].wire===q.wire);
      return heads.reduce((best,x)=>rank[x.q.to]<rank[best.q.to]?x:best).i;
    }
    return 0;
  }
  function queueTask(s,m,c) {
    const task={id:executionId(c),cursor:c.id,generation:c.generation,op:c.op,ticket:'t'+s.nextSerial,serial:s.nextSerial++};
    m.ready.push(task);
    if(s.schedule==='seeded' && hash(task.id+':'+s.seed)%7===0) m.ready.push({...task,ticket:'t'+s.nextSerial,serial:s.nextSerial++});
  }
  function nextTask(s,m,c,pc) { c.pc=pc; c.op++; queueTask(s,m,c); }
  function frame(s,message,copy=false) {
    const key=message.from+' → '+message.to;
    if(!s.links[key]) s.links[key]={from:message.from,to:message.to,queue:[],logicalSent:0,attempts:0,delivered:0,recent:[]};
    const link=s.links[key];
    link.queue.push({...clone(message),link:key,wire:'w'+s.nextSerial,serial:s.nextSerial++,copy});
    link.attempts++; s.metrics.attemptsSent++;
  }
  function send(s,kind,from,to,id,payload) {
    const message={kind,from,to,id,payload:clone(payload)};
    if(own(s.logical,id)) throw Error('Logical message emitted twice: '+id);
    s.logical[id]=clone(message); frame(s,message);
    s.links[from+' → '+to].logicalSent++; s.metrics.logicalSent++;
    if(s.schedule==='duplicates' || (s.schedule==='seeded' && hash(id+':'+s.seed)%3===0)) frame(s,message,true);
  }
  function sendCursor(s,kind,from,to,c) {
    const payload=clone(c); payload.server=to; payload.pc='visit'; payload.op=0;
    send(s,kind,from,to,s.queryId+':delivery:'+c.id+':g'+c.generation,{cursor:payload});
  }
  function refresh(s) {
    // Read-only observer projection used by the renderer, never protocol handlers.
    const view={};
    function offer(c) {
      const old=view[c.id];
      if(!old || c.generation>old.generation || (c.generation===old.generation && ['route','dispatch','forwarded'].includes(old.pc))) view[c.id]=clone(c);
    }
    for(const q of messages(s)) if(['dispatch','transfer'].includes(q.kind)) offer({...q.payload.cursor,pc:q.kind==='dispatch'?'dispatch':'route',server:q.from,transitTo:q.to});
    for(const m of Object.values(s.machines)) for(const c of Object.values(m.cursors)) offer(c);
    s.cursors=view;
    s.received=Object.values(s.control.results);
    s.distinct=s.control.distinct.slice();
    s.rootDone=s.control.expected!==null;
    s.complete=queryComplete(s.control);
    if(s.complete && s.completionTick===null) s.completionTick=s.tick;
    s.quiescent=workItems(s).length===0;
  }
  function create(scenario='chain',schedule='fifo',override,options={}) {
    if(!scenarios[scenario]&&!override) throw Error('Unknown scenario');
    if(!schedules[schedule]) throw Error('Unknown schedule');
    const data=clone(override||scenarios[scenario]);
    const seed=(options.seed===undefined?12648430:options.seed)>>>0;
    const s={scenario,schedule,data,queryId:'q1',seed,rng:seed,nextSerial:1,tick:0,
      machines:Object.fromEntries(Object.keys(servers).map(id=>[id,{id,cursors:{},ready:[],accepted:{},executed:{}}])),
      links:{},logical:{},control:{queryId:'q1',rootId:'c1',startOwner:node(data,data.start).owner,expected:null,results:{},distinct:[],deliveries:0,duplicateResults:0,duplicateRoots:0},
      metrics:{logicalSent:0,attemptsSent:0,delivered:0,localSteps:0,ignored:{result:0,ack:0,transfer:0,dispatch:0,rootDone:0,run:0}},
      transfers:0,completionTick:null,history:[],event:{type:'start',title:'Query created on the coordinator',detail:'Step delivers initial dispatch. '+scheduleNotes[schedule]}};
    sendCursor(s,'dispatch','coordinator',s.control.startOwner,cursor('c1',null,[data.start],s.control.startOwner));
    refresh(s); assertState(s); return s;
  }
  function ignore(s,kind,q,detail) {
    s.metrics.ignored[kind]++;
    return {type:'duplicate',messageKind:kind,title:'Ignore duplicate '+kind,detail,from:q.from,to:q.to,messageId:q.id,cursor:q.payload?.cursor?.id||q.payload?.parent||q.cursor};
  }
  function deliver(s,q) {
    const p=q.payload;
    if(q.to==='coordinator') {
      const c=s.control; c.deliveries++;
      if(q.kind==='result') {
        if(own(c.results,q.id)) { c.duplicateResults++; return ignore(s,'result',q,'Stable result ID '+q.id+' was already received. Neither unique-message count nor distinct-person count changes.'); }
        c.results[q.id]={...clone(p),resultId:q.id};
        if(!c.distinct.includes(p.node)) c.distinct.push(p.node);
        return {type:'result',title:'Unique result received: '+node(s.data,p.node).name,detail:names(s.data,p.path)+'. Received '+Object.keys(c.results).length+' unique result IDs.',cursor:p.cursor,node:p.node};
      }
      if(q.kind==='rootDone') {
        if(c.expected!==null) { if(c.expected!==p.count) throw Error('Conflicting root completion'); c.duplicateRoots++; return ignore(s,'rootDone',q,'The same root completion count was already accepted.'); }
        c.expected=p.count;
        return {type:'complete',title:'rootDone promises '+p.count+' results',detail:coordinatorReason(c),cursor:'c1'};
      }
      throw Error('Unexpected coordinator message');
    }
    const m=s.machines[q.to];
    if(['dispatch','transfer'].includes(q.kind)) {
      if(own(m.accepted,q.id)) {
        if(m.accepted[q.id]!==JSON.stringify(p.cursor)) throw Error('Conflicting cursor retry');
        return ignore(s,q.kind,q,'Delivery '+q.id+' was accepted earlier. The old delivery cannot restart, roll back or execute this cursor again.');
      }
      const c=clone(p.cursor),old=m.cursors[c.id];
      if(old && old.generation>=c.generation) throw Error('Unexpected stale/new cursor delivery');
      m.accepted[q.id]=JSON.stringify(c);m.cursors[c.id]=c;queueTask(s,m,c);
      if(q.kind==='transfer') s.transfers++;
      return {type:q.kind,title:q.kind==='dispatch'?'Coordinator dispatches c1 → '+q.to:c.id+' arrives directly: '+q.from+' → '+q.to,
        detail:'Accept '+q.id+'. Generation '+c.generation+' is a new ownership epoch; operation 0 is queued locally. Path and counts are preserved.',cursor:c.id,node:c.path.at(-1),edge:q.kind==='transfer'?c.path.slice(-2):undefined};
    }
    if(q.kind==='ack') {
      const c=m.cursors[p.parent];
      if(!c||!c.sealed||!c.children.includes(p.child)) throw Error('Completion for unregistered child');
      if(own(c.childCounts,p.child)) { if(c.childCounts[p.child]!==p.count) throw Error('Conflicting child completion'); return ignore(s,'ack',q,'Child '+p.child+' already contributed '+p.count+'. Its subtree count is not added twice.'); }
      c.childCounts[p.child]=p.count;c.acknowledged.push(p.child);
      const left=c.children.length-Object.keys(c.childCounts).length;
      if(!left) nextTask(s,m,c,'finish');
      return {type:'join',title:left?'Child count accepted; parent waits':'Final child count joined',detail:p.child+' contributes '+p.count+' result messages to '+c.id+'. '+left+' child completions missing.',cursor:c.id,node:c.path.at(-1)};
    }
    throw Error('Unexpected server message '+q.kind);
  }
  function execute(s,m,task) {
    if(own(m.executed,task.id)) return ignore(s,'run',task,'Execution token '+task.id+' already ran. Later operations use different op numbers; later arrivals use different generations.');
    const c=m.cursors[task.cursor];
    if(!c||c.generation!==task.generation||c.op!==task.op||!runnable(c)) throw Error('Invalid execution token '+task.id);
    m.executed[task.id]=true;s.metrics.localSteps++;
    const id=c.path.at(-1),current=node(s.data,id),hops=c.path.length-1;
    const base={cursor:c.id,node:id,executionId:task.id};
    if(c.pc==='route') {
      const to=current.owner;if(to===m.id) throw Error('Local node routed remotely');
      const payload={...clone(c),generation:c.generation+1};
      sendCursor(s,'transfer',m.id,to,payload);c.pc='forwarded';c.transitTo=to;
      return {...base,type:'transfer-send',title:c.id+' hands off '+m.id+' → '+to,detail:'Queue generation '+payload.generation+'. This server retains only a forwarding tombstone and cannot execute it.',from:m.id,to,edge:c.path.slice(-2)};
    }
    if(c.server!==current.owner) throw Error('Remote local read');
    if(c.pc==='visit') {
      nextTask(s,m,c,hops>0&&id!==s.data.start?'emit':'expand');
      return {...base,type:'read',title:c.id+' reads '+current.name+' locally',detail:'Generation '+c.generation+', operation '+task.op+'. '+hops+' / '+s.data.maxHops+' graph hops. No cross-server depth increment.'};
    }
    if(c.pc==='emit') {
      const resultId=s.queryId+':result:'+JSON.stringify(c.path);
      c.ownCount++;c.emitted.push(resultId);
      send(s,'result',m.id,'coordinator',resultId,{cursor:c.id,node:id,path:c.path.slice(),token:token(c.path),...(s.data.queryKind==='movies'?{row:{title:current.title,year:current.year}}:s.data.queryKind==='restaurants'?{role:current.kind,group:current.kind==='City'?id:c.path[1],row:current.kind==='City'?{name:current.name}:{name:current.name,rating:current.rating},...(current.kind==='City'?{expectedCandidates:outgoing(s.data,id).length}:{})}:{})});
      nextTask(s,m,c,'expand');
      return {...base,type:'emit',title:c.id+' emits '+current.name,detail:'Own logical count is '+c.ownCount+'. Retries retain result ID '+resultId+'.',from:m.id,to:'coordinator'};
    }
    if(c.pc==='expand') {
      const next=outgoing(s.data,id);
      if(hops>=s.data.maxHops||!next.length) {
        c.sealed=true;nextTask(s,m,c,'finish');
        return {...base,type:'bound',title:hops>=s.data.maxHops?'Hop bound reached':'No more relationships',detail:'Local work is sealed. The final child set is empty; this cursor can report its own count.'};
      }
      if(next.length===1) {
        c.path.push(next[0]);nextTask(s,m,c,node(s.data,next[0]).owner===m.id?'visit':'route');
        return {...base,type:'follow',title:c.id+' follows '+current.name+' → '+node(s.data,next[0]).name,detail:'Continue the same work ID; add exactly one graph hop.',edge:[id,next[0]]};
      }
      c.children=next.map((_,i)=>c.id+'.'+(i+1));c.sealed=true;c.pc='wait';
      next.forEach((to,i)=>{
        const child=cursor(c.children[i],c.id,[...c.path,to],node(s.data,to).owner);child.parentServer=m.id;
        if(child.server===m.id) {m.cursors[child.id]=child;queueTask(s,m,child);}
        else {m.cursors[child.id]={...clone(child),server:m.id,generation:-1,pc:'forwarded',transitTo:child.server};sendCursor(s,'transfer',m.id,child.server,child);}
      });
      return {...base,type:'fork',title:c.id+' registers '+next.length+' children',detail:'Seal the final child set before sending any child. Each has its own path. Parent waits for one count per child; own count '+c.ownCount+'.'};
    }
    if(c.pc==='finish') {
      if(!c.sealed||c.children.some(id=>!own(c.childCounts,id))) throw Error('Premature local completion');
      c.total=c.ownCount+sum(Object.values(c.childCounts));c.pc='done';
      const to=c.parent?c.parentServer:'coordinator',kind=c.parent?'ack':'rootDone';
      send(s,kind,m.id,to,s.queryId+':done:'+c.id,{parent:c.parent,child:c.id,count:c.total});
      return {...base,type:'finish',title:c.id+' completes subtree count '+c.total,detail:c.ownCount+' own + '+sum(Object.values(c.childCounts))+' child results. Queue '+kind+' to '+to+'.',from:m.id,to};
    }
    throw Error('Unknown cursor phase');
  }
  function step(previous,choice) {
    if(previous.quiescent) return clone(previous);
    assertState(previous);
    const s=clone(previous),items=workItems(s);
    const q=choice===undefined?items[pick(s)]:items.find(x=>(x.wire||x.ticket)===(typeof choice==='string'?choice:choice.wire||choice.ticket));
    if(!q) throw Error('Chosen work is not pending');
    if(s.schedule==='seeded') s.rng=random(s.rng);
    s.tick++;let e;
    if(q.kind==='run') {
      const m=s.machines[q.server];m.ready.splice(m.ready.findIndex(t=>t.ticket===q.ticket),1);
      e=execute(s,m,q);
    } else {
      const link=s.links[q.link];link.queue.splice(link.queue.findIndex(x=>x.wire===q.wire),1);
      s.metrics.delivered++;link.delivered++;
      e=deliver(s,q);e={...e,from:q.from,to:q.to,messageId:q.id,wire:q.wire,messageKind:q.kind};
      link.recent.push({tick:s.tick,kind:q.kind,id:q.id,duplicate:e.type==='duplicate'});link.recent=link.recent.slice(-5);
    }
    refresh(s);
    e.detail+=' '+coordinatorReason(s.control);
    if(s.complete&&!previous.complete) e.title+=' · QUERY COMPLETE';
    s.event=e;s.history.push({tick:s.tick,...e});
    assertState(s);return s;
  }
  function injectDuplicate(previous,logicalId,count=1) {
    const s=clone(previous),message=s.logical[logicalId];if(!message) throw Error('Unknown logical message');
    for(let i=0;i<count;i++) frame(s,message,true);
    refresh(s);assertState(s);return s;
  }
  function injectTaskDuplicate(previous,server,ticket) {
    const s=clone(previous),m=s.machines[server],task=m.ready.find(t=>t.ticket===ticket);if(!task) throw Error('Unknown local task');
    m.ready.push({...task,ticket:'t'+s.nextSerial,serial:s.nextSerial++});refresh(s);assertState(s);return s;
  }
  // Independent DFS, with no protocol state or pruning.
  function reference(data) {
    const paths=[];
    function visit(path) {const id=path.at(-1),depth=path.length-1;
      if(depth&&id!==data.start) paths.push({token:token(path),node:id,path:path.slice()});
      if(depth===data.maxHops)return;
      for(const to of outgoing(data,id))visit([...path,to]);
    }
    visit([data.start]);return {distinct:[...new Set(paths.map(p=>p.node))].sort(),tokens:paths.map(p=>p.token).sort(),count:paths.length};
  }
  function comparison(s) {
    const expected=reference(s.data),actual={distinct:[...s.distinct].sort(),tokens:s.received.map(r=>r.token).sort(),count:s.received.length};
    return {passed:s.complete&&JSON.stringify(expected.distinct)===JSON.stringify(actual.distinct)&&JSON.stringify(expected.tokens)===JSON.stringify(actual.tokens),expected,actual};
  }
  // Pure coordinator-local summary. No links, machines, oracle, or pending metric.
  function coordinator(s) {
    const c=s.control,received=Object.keys(c.results).length;
    return {phase:queryComplete(c)?'complete':c.expected===null?'waiting for rootDone':'waiting for results',
      expected:c.expected,receivedResults:received,rootDone:c.expected!==null,complete:queryComplete(c),reason:coordinatorReason(c),
      dispatch:{cursor:c.rootId,to:c.startOwner,delivered:null},deliveries:c.deliveries,duplicateResults:c.duplicateResults,duplicateRoots:c.duplicateRoots,
      distinct:c.distinct.slice()};
  }
  function assertState(s) {
    const fail=message=>{throw Error('Invariant: '+message);};
    const ids=s.data.nodes.map(n=>n.id);
    if(!Number.isInteger(s.data.maxHops)||s.data.maxHops<0)fail('invalid bound');
    if(new Set(ids).size!==ids.length||!(ids.includes(s.data.start)||s.data.start==='@cities'))fail('invalid node IDs');
    if(s.data.nodes.some(n=>!servers[n.owner]))fail('invalid owner');
    if(s.data.edges.some(([a,b])=>!ids.includes(a)||!ids.includes(b)))fail('invalid edge');
    if(new Set(s.data.edges.map(e=>JSON.stringify(e))).size!==s.data.edges.length)fail('parallel edges unsupported');
    const validPath=p=>p[0]===s.data.start&&p.length-1<=s.data.maxHops&&p.every((id,i)=>(ids.includes(id)||id==='@cities')&&(!i||outgoing(s.data,p[i-1]).includes(id)));
    const live={};
    for(const m of Object.values(s.machines)) for(const c of Object.values(m.cursors)) {
      if(!validPath(c.path))fail('invalid cursor path');
      if(c.server!==m.id)fail('wrong local cursor server');
      if(c.ownCount!==c.emitted.length||new Set(c.emitted).size!==c.emitted.length)fail('own count mismatch');
      if(c.pc!=='forwarded') {if(live[c.id])fail('two execution owners');live[c.id]=c;}
      if(runnable(c)&&!m.ready.some(t=>t.id===executionId(c)&&!own(m.executed,t.id)))fail('runnable cursor missing local task');
      if(!['route','forwarded'].includes(c.pc)&&node(s.data,c.path.at(-1)).owner!==m.id)fail('remote local operation');
      if(new Set(c.children).size!==c.children.length)fail('duplicate child ID');
      if(Object.keys(c.childCounts).some(id=>!c.children.includes(id)||!Number.isInteger(c.childCounts[id])||c.childCounts[id]<0))fail('invalid child count');
      if(c.pc==='wait'&&(!c.sealed||!c.children.length||c.children.every(id=>own(c.childCounts,id))))fail('invalid waiting parent');
      if(['finish','done'].includes(c.pc)&&(!c.sealed||c.children.some(id=>!own(c.childCounts,id))))fail('parent finished before final child set');
      if(c.pc==='done'&&c.total!==c.ownCount+sum(Object.values(c.childCounts)))fail('subtree total mismatch');
    }
    for(const link of Object.values(s.links))for(const q of link.queue) {
      if(q.from!==link.from||q.to!==link.to||!own(s.logical,q.id))fail('invalid directed link envelope');
      if(JSON.stringify(s.logical[q.id].payload)!==JSON.stringify(q.payload))fail('retry payload changed');
    }
    const results=Object.entries(s.control.results);
    if(results.some(([id,r])=>!validPath(r.path)||r.path.length<2||r.node===s.data.start||r.path.at(-1)!==r.node||id!==s.queryId+':result:'+JSON.stringify(r.path)))fail('invalid unique result');
    if(JSON.stringify([...s.control.distinct].sort())!==JSON.stringify([...new Set(results.map(([,r])=>r.node))].sort()))fail('distinct output mismatch');
    if(s.control.expected!==null&&(!Number.isInteger(s.control.expected)||s.control.expected<results.length))fail('invalid expected count');
    if(s.complete!==queryComplete(s.control))fail('completion must use coordinator local state only');
    if(s.quiescent!==(workItems(s).length===0))fail('incorrect observer quiescence');
    if(s.quiescent&&!s.complete)fail('deadlock before completion');
    return true;
  }
  root.CursorLab=Object.freeze({scenarios,servers,schedules,scheduleNotes,create,step,reference,comparison,coordinator,queryComplete,coordinatorReason,assertState,pending,active,pick,target,messages,workItems,injectDuplicate,injectTaskDuplicate,names,token,node,outgoing});
})(typeof globalThis!=='undefined'?globalThis:this);
