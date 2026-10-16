(function () {
  'use strict';
  const E = CursorLab, $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Verified against local ZQL lang/mod.rs (ranges/filters) and v2.rs walk_range.
  // This displays the distinct-reachability query; the JS engine also records walks.
  function queryText(data) { return CursorQueries.query(data); }
  function responseEntries(data,control){ return CursorQueries.entries(data,control); }
  function coordinatorUserResponse(data,control){ return CursorQueries.project(data,control); }
  function coordinatorResponseJSON(data,control){ return JSON.stringify(coordinatorUserResponse(data,control),null,2); }
  function responseChange(data,before,after){ return CursorQueries.change(data,before,after); }
  let reference={status:'not-run',signature:null,result:null,error:null},referenceToken=0;
  const signature=data=>JSON.stringify(data)+'\n'+queryText(data);
  function renderReference(s){
    const current=reference.signature===signature(s.data);
    $('wasmStatus').textContent=reference.status==='complete'&&current?'Complete · single in-memory Zega instance':reference.status==='error'?'Reference error':reference.status==='running'?'Running Zega locally…':'Not run for this fixture and query';
    $('wasmResult').textContent=current&&reference.status==='complete'?JSON.stringify(reference.result,null,2):reference.error||'Run Zega to execute the displayed ZQL.';
    const eligible=s.complete&&current&&reference.status==='complete';
    const check=eligible?CursorQueries.compare(coordinatorUserResponse(s.data,s.control),reference.result):null;
    $('wasmComparison').textContent=check?(check.match?'✓ MATCH · ':'✕ MISMATCH · ')+check.detail:!s.complete?'Comparison pending: simulated query is partial.':'Comparison pending: run Zega for this fixture and query.';
    $('wasmComparison').classList.toggle('bad',!!check&&!check.match);
    $('runZega').disabled=reference.status==='running';
  }
  function invalidateReference(){referenceToken++;reference={status:'not-run',signature:null,result:null,error:null};}
  async function runReference(){
    const data=JSON.parse(JSON.stringify(state().data)),source=queryText(data),key=signature(data),ticket=++referenceToken;
    reference={status:'running',signature:key,result:null,error:null};renderReference(state());
    try{
      const runtime=await window.ZegaRuntime;
      if(ticket!==referenceToken)return;
      const result=CursorQueries.run(runtime.ZegaWasm,data,source);
      if(ticket!==referenceToken||key!==signature(state().data))return;
      reference={status:'complete',signature:key,result,error:null};
    }catch(error){if(ticket!==referenceToken)return;reference={status:'error',signature:key,result:null,error:String(error.message||error)};}
    renderReference(state());
  }
  let snapshots = [], position = 0, selected = 'c1', timer = null;
  const state = () => snapshots[position];
  const label = (s, id) => E.node(s.data,id).name;
  const phase = { dispatch: 'initial dispatch queued', route: 'transfer queued', visit: 'read local node', emit: 'emit result', expand: 'follow / fork', wait: 'waiting for children', finish: 'finish queued', forwarded: 'forwarding tombstone', done: 'done' };
  function stop() { if (timer) clearInterval(timer); timer = null; $('play').textContent = '▶ Play'; }
  function reset() { stop();invalidateReference(); snapshots = [E.create($('scenario').value, $('schedule').value)]; position = 0; selected = 'c1'; render(); }
  function advance() {
    try {
      if (position < snapshots.length - 1) position++;
      else if (!state().quiescent) { snapshots.push(E.step(state())); position++; }
      selected = state().event.cursor || selected;
      if (state().quiescent) stop();
      render();
    } catch (error) { stop(); $('fatal').classList.remove('hidden'); $('fatal').textContent = 'Simulation stopped: ' + error.message; console.error(error); }
  }
  function graph(s) {
    if(window.ClusterGraph)window.ClusterGraph.render(s,selected);
  }
  function protocolPanels(s) {
    const frames=E.messages(s),ignored=Object.values(s.metrics.ignored).reduce((a,b)=>a+b,0);
    $('transportStats').textContent=frames.length+' pending · '+s.metrics.delivered+' deliveries · '+ignored+' retries ignored';
    $('scheduleNote').textContent=E.scheduleNotes[s.schedule]+(s.schedule==='seeded'?' Current seed: '+s.seed+'.':'');
    $('linkQueues').innerHTML=Object.entries(s.links).map(([key,link])=>{
      const pending=link.queue.map(q=>{
        const p=q.payload;
        const description=q.kind==='result'?label(s,p.node)+' · '+E.names(s.data,p.path):q.kind==='ack'||q.kind==='rootDone'?'subtree '+p.child+' · count '+p.count:p.cursor.id+' · generation '+p.cursor.generation;
        return '<li>'+esc(q.kind)+(q.copy?'<span class="retry-pill">retry copy</span>':'')+'<br>'+esc(description)+'<br><span class="small">'+esc(q.id)+'</span></li>';
      }).join('');
      const delivered=link.recent.slice(-2).reverse().map(q=>'<li class="received-frame">✓ step '+q.tick+' · '+esc(q.kind)+(q.duplicate?' · ignored duplicate':' · accepted')+'</li>').join('');
      return '<section class="link-box" data-directed-link="'+esc(key)+'"><h4>'+esc(key)+(link.from===link.to?' · local mailbox':'')+'</h4><p>'+link.queue.length+' pending / '+link.delivered+' delivered · '+link.logicalSent+' logical sends, '+link.attempts+' attempts</p><ul>'+pending+delivered+(pending||delivered?'':'<li>No traffic yet.</li>')+'</ul></section>';
    }).join('');
    $('serverStates').innerHTML=Object.values(s.machines).map(m=>{
      const rows=Object.values(m.cursors).map(c=>{
        const children=c.children.map(id=>id+': '+(Object.prototype.hasOwnProperty.call(c.childCounts,id)?c.childCounts[id]:'waiting')).join(' · ');
        return '<li><strong>'+esc(c.id)+' / g'+c.generation+' · '+esc(phase[c.pc])+'</strong><span>own '+c.ownCount+' + children '+Object.values(c.childCounts).reduce((a,b)=>a+b,0)+' = '+(c.total===null?'not final':c.total)+' · '+(c.sealed?'child set sealed':'local work open')+'</span>'+(children?'<span>'+esc(children)+'</span>':'')+'<span>'+esc(E.names(s.data,c.path))+'</span></li>';
      }).join('');
      return '<section class="server-box"><h4>Server '+m.id+'</h4><p>'+m.ready.length+' queued local tasks · '+Object.keys(m.accepted).length+' accepted delivery IDs · '+Object.keys(m.executed).length+' executed operation tokens</p><ul>'+(rows||'<li>No cursor state yet.</li>')+'</ul></section>';
    }).join('');
  }
  let lastExecutionTick=null;
  function renderExecutionTimeline(s){
    const model=CursorTimeline.project(snapshots,s.tick),pitch=56,axis=32,row=70;
    const laneIds=['@coordinator',...model.lanes.map(l=>l.id)];
    const ys=Object.fromEntries(laneIds.map((id,i)=>[id,axis+i*row+row/2]));
    const x=tick=>24+tick*pitch,width=Math.max(600,x(model.currentTick)+40),height=axis+laneIds.length*row;
    const color=server=>E.servers[server]?.color||'#346748';
    $('executionSummary').textContent=model.lanes.length+' cursor lane'+(model.lanes.length===1?'':'s')+' · visible through step '+s.tick;
    $('executionLanes').innerHTML='<div class="execution-lane"><strong>Coordinator</strong><small>Receipt rail · not a cursor</small></div>'+model.lanes.map(l=>'<div class="execution-lane"><strong>'+esc(l.id)+'</strong><small>'+esc(l.parent?'child of '+l.parent:'root work')+'</small><small>'+esc(l.current.server+' · '+phase[l.current.status])+'</small></div>').join('');
    let svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Cursor execution through step '+s.tick+'. Time runs left to right; cursor IDs occupy separate lanes." data-visible-step="'+s.tick+'"><defs><marker id="execution-ack-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8160a8"/></marker></defs>';
    for(let tick=0;tick<=s.tick;tick++){
      if(tick%5===0||tick===s.tick)svg+='<line x1="'+x(tick)+'" y1="25" x2="'+x(tick)+'" y2="'+height+'" stroke="#e5ebdf"/><text x="'+x(tick)+'" y="17" text-anchor="middle" font-family="monospace" font-size="10" fill="'+(tick===s.tick?'#245d44':'#8b998a')+'">'+tick+'</text>';
    }
    laneIds.forEach(id=>{svg+='<line x1="0" y1="'+(ys[id]+row/2)+'" x2="'+width+'" y2="'+(ys[id]+row/2)+'" stroke="#edf0e8"/>';});
    svg+='<line x1="'+x(0)+'" y1="'+ys['@coordinator']+'" x2="'+x(s.tick)+'" y2="'+ys['@coordinator']+'" stroke="#b8cce0" stroke-width="1.3" stroke-dasharray="2 5"/>';
    for(const lane of model.lanes){
      for(const segment of lane.segments){
        const tint=segment.style==='inflight'?'#b47b15':segment.style==='messages'?'#c3ccbf':color(segment.server);
        const dash=segment.style==='execution'?'':segment.style==='messages'?'2 5':'5 4';
        svg+='<path data-timeline-progress="'+segment.style+'" data-cursor="'+esc(lane.id)+'" data-start="'+segment.start+'" data-end="'+segment.end+'" d="M '+x(segment.start)+' '+ys[lane.id]+' H '+x(segment.end)+'" fill="none" stroke="'+tint+'" stroke-width="'+(segment.style==='messages'?1.2:2.8)+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>';
      }
      svg+='<circle cx="'+x(lane.birthTick)+'" cy="'+ys[lane.id]+'" r="3.5" fill="white" stroke="#91a18b"><title>'+esc(lane.id)+' exists at step '+lane.birthTick+'</title></circle>';
    }
    for(const fork of model.forks){
      const fx=x(fork.tick),py=ys[fork.parent],cy=ys[fork.child];
      svg+='<path data-timeline-kind="fork" data-parent="'+esc(fork.parent)+'" data-child="'+esc(fork.child)+'" data-step="'+fork.tick+'" d="M '+fx+' '+py+' C '+(fx-18)+' '+py+' '+(fx-18)+' '+cy+' '+fx+' '+cy+'" fill="none" stroke="#68875c" stroke-width="2"><title>Fork creates '+esc(fork.child)+' from '+esc(fork.parent)+' at step '+fork.tick+'</title></path>';
    }
    for(const join of model.joins){
      const sx=x(join.sourceTick),tx=x(join.tick),middle=(sx+tx)/2;
      svg+='<path data-timeline-kind="ack-join" data-parent="'+esc(join.parent)+'" data-child="'+esc(join.child)+'" data-step="'+join.tick+'" d="M '+sx+' '+ys[join.child]+' C '+middle+' '+ys[join.child]+' '+middle+' '+ys[join.parent]+' '+tx+' '+ys[join.parent]+'" fill="none" stroke="#8160a8" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#execution-ack-arrow)"><title>Completion ACK: '+esc(join.child)+' contributes '+join.count+' to '+esc(join.parent)+'. No graph nodes or paths are merged.</title></path>';
    }
    for(const event of model.events){
      const xx=x(event.tick),yy=ys[event.lane];if(yy===undefined)continue;
      const tint=color(event.server);let glyph,annotation='';
      if(event.marker==='duplicate') {glyph='<path d="M '+(xx-5)+' '+(yy-5)+' L '+(xx+5)+' '+(yy+5)+' M '+(xx+5)+' '+(yy-5)+' L '+(xx-5)+' '+(yy+5)+'" stroke="#7a857a" stroke-width="2"/>';annotation='ignore';}
      else if(event.marker==='emission'){glyph='<path d="M '+xx+' '+(yy-6)+' L '+(xx+6)+' '+yy+' L '+xx+' '+(yy+6)+' L '+(xx-6)+' '+yy+' Z" fill="#36805a"/>';annotation='emit';}
      else if(event.marker==='transfer'){glyph='<rect x="'+(xx-5)+'" y="'+(yy-5)+'" width="10" height="10" rx="1" fill="'+(event.type==='transfer-send'?'white':'#eab55c')+'" stroke="#a87213" stroke-width="1.8"/>';annotation=(event.type==='transfer-send'?'send ':'')+(event.from==='coordinator'?'coord':event.from)+'→'+event.to;}
      else if(event.marker==='fork'){glyph='<circle cx="'+xx+'" cy="'+yy+'" r="5" fill="#68875c"/>';annotation='fork';}
      else if(event.marker==='ack'){glyph='<rect x="'+(xx-5)+'" y="'+(yy-5)+'" width="10" height="10" rx="3" fill="#f4edfb" stroke="#8160a8" stroke-width="1.8"/>';annotation='ACK '+model.joins.find(j=>j.tick===event.tick).count;}
      else if(event.marker==='finish'){glyph='<circle cx="'+xx+'" cy="'+yy+'" r="6" fill="'+tint+'"/><path d="M '+(xx-3)+' '+yy+' l 2 2 l 4 -4" fill="none" stroke="white" stroke-width="1.4"/>';annotation='end '+event.subtreeCount;}
      else if(event.marker==='receipt'){glyph='<circle cx="'+xx+'" cy="'+yy+'" r="5" fill="#427cc4"/>';annotation=event.type==='complete'?'root '+event.expected:event.type==='start'?'query':'recv';}
      else {glyph='<circle cx="'+xx+'" cy="'+yy+'" r="4" fill="'+tint+'"/>';if(event.type==='read')annotation=event.node?label(s,event.node):'read';}
      const aria='Step '+event.tick+': '+event.title+'. '+(event.cursor?'Cursor '+event.cursor+'. ':'')+'Select recorded state.';
      svg+='<g class="execution-marker" role="button" tabindex="0" aria-label="'+esc(aria)+'" data-execution-step="'+event.tick+'" data-marker="'+event.marker+'" data-cursor="'+esc(event.cursor||'coordinator')+'"><title>'+esc(aria)+'</title><circle class="execution-hit" cx="'+xx+'" cy="'+yy+'" r="12" fill="'+(event.tick===s.tick?'#e3eedb':'transparent')+'" stroke="'+(event.tick===s.tick?'#9eb88e':'transparent')+'"/>'+glyph+(annotation?'<text x="'+xx+'" y="'+(yy+23)+'" text-anchor="middle" font-family="monospace" font-size="9" fill="'+(event.marker==='duplicate'?'#7a857a':'#637460')+'">'+esc(annotation)+'</text>':'')+'</g>';
    }
    $('executionGraph').innerHTML=svg+'</svg>';
    if(lastExecutionTick!==s.tick){const pane=$('executionScroll');pane.scrollLeft=Math.max(0,x(s.tick)-(Number(pane.clientWidth)||600)+96);lastExecutionTick=s.tick;}
    const entry=model.selected;
    $('executionEventHeading').textContent='Step '+entry.tick+' · '+entry.title;
    const childText=entry.children?Object.keys(entry.childCounts).length+' / '+entry.children.length+' ACKs · '+(Object.entries(entry.childCounts).map(([id,count])=>id+'='+count).join(', ')||'none yet'):'not a cursor event';
    const fields={Cursor:entry.cursor||'coordinator', 'Event node':entry.node?label(s,entry.node):'not reported', 'Path depth':entry.depth===null?'not reported':entry.depth, 'Handled at':entry.server,
      'Cursor after':entry.cursor?(entry.cursorServer+' · '+(phase[entry.status]||entry.status)):'coordinator local state','After gen':entry.generation===null?'—':entry.generation,
      Children:childText,Counts:entry.ownCount===null?'not a cursor event':'own '+entry.ownCount+' + children '+Object.values(entry.childCounts).reduce((a,b)=>a+b,0)+'; subtree '+(entry.subtreeCount===null?'not final':entry.subtreeCount),
      Coordinator:entry.received+' / '+(entry.expected===null?'?':entry.expected)+' unique results',Identity:entry.messageId||entry.executionId||'query created'};
    $('executionDetails').innerHTML=Object.entries(fields).map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd>').join('');
    $('executionDescription').textContent=entry.detail+(entry.marker==='ack'?' This is a child completion acknowledgment, not a merge of graph nodes or walk paths.':entry.marker==='duplicate'?' The cross marks an ignored retry, not a second execution.':'');
  }
  function selectExecutionEvent(event){
    const marker=event.target.closest?.('[data-execution-step]');if(!marker)return;
    const tick=Number(marker.dataset.executionStep);if(!Number.isInteger(tick)||tick<0||tick>state().tick)return;
    const index=snapshots.findIndex(s=>s.tick===tick);if(index<0)return;
    stop();position=index;selected=CursorTimeline.project(snapshots,tick).selected.cursor||'c1';render();
    if(typeof $('executionEventHeading').focus==='function')$('executionEventHeading').focus({preventScroll:true});
  }
  function renderUserResponse(s){
    const previous=position>0?snapshots[position-1].control:{results:{}};
    const change=responseChange(s.data,previous,s.control);
    $('results').textContent=coordinatorResponseJSON(s.data,s.control);
    $('userResponseState').textContent=s.complete?'Final ZQL response':'Partial ZQL response · assembled from received results';
    $('userResponsePanel').classList.toggle('response-updated',change.changed);
    $('responseConnector').classList.toggle('is-active',change.changed);
    $('responseUpdateLabel').textContent=change.changed?'Step '+s.tick+': return data updated':'No return-data change';
    $('responseChangeDetail').textContent=change.changed?(change.added.length?'+ Added '+change.added.map(entry=>JSON.stringify(entry)).join(', '):'↕ Existing response entries changed or reordered.'):
      s.tick===0?'Awaiting result receipts.':s.event.type==='duplicate'?'Protocol retry ignored; user response unchanged.':s.event.type==='result'?'A receipt arrived without changing the selected response; user response unchanged.':s.complete?'Query complete; return data unchanged on this step.':'Protocol step only; no user-response update.';
  }
  function refreshResponseConnector(){
    const grid=$('mainGrid').getBoundingClientRect(),source=$('coordinatorServer').getBoundingClientRect(),target=$('userResponsePanel').getBoundingClientRect();
    const values=[grid.left,grid.top,grid.width,grid.height,source.right,source.top,target.left,target.top];
    if(values.some(value=>!Number.isFinite(value))||source.right>=target.left||grid.width<=0||grid.height<=0){$('responseConnector').innerHTML='';return;}
    const x1=source.right-grid.left,y1=source.top-grid.top+28,x2=target.left-grid.left,y2=target.top-grid.top+25,middle=(x1+x2)/2;
    $('responseConnector').innerHTML='<svg viewBox="0 0 '+grid.width+' '+grid.height+'" preserveAspectRatio="none"><defs><marker id="return-data-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#587c56"/></marker></defs><path class="response-wire" d="M '+x1+' '+y1+' C '+middle+' '+y1+' '+middle+' '+y2+' '+x2+' '+y2+'" fill="none" marker-end="url(#return-data-arrow)"/></svg>';
  }
  function render() {
    const s=state(),e=s.event,coord=E.coordinator(s),comparison=E.comparison(s);
    E.assertState(s);
    $('query').textContent=s.data.queryKind==='movies'?'Which fictional movies connect to Robert Downey Jr.?':s.data.queryKind==='restaurants'?'Gather ten restaurant candidates for each of five cities.': 'Who can '+label(s,s.data.start)+' reach within '+s.data.maxHops+' follows hops?';
    $('semantics').textContent=s.data.queryKind?'Fixed query plan · owner-local selected fields · counted child completion':'Bounded walks · repeats allowed · exclude start · distinct output / unique path-message IDs';
    $('scenarioDescription').textContent=s.data.description;$('hopBound').textContent=s.data.maxHops;
    $('stepLabel').textContent='STEP '+String(s.tick).padStart(2,'0')+(s.quiescent?' · ALL TRAFFIC DRAINED':s.complete?' · QUERY DONE / RETRIES REMAIN':' · '+s.schedule.toUpperCase());
    $('back').disabled=position===0;
    $('step').disabled=s.quiescent&&position===snapshots.length-1;
    $('play').disabled=s.quiescent&&position===snapshots.length-1;
    $('timeline').max=snapshots.length-1;$('timeline').value=position;$('timelineLabel').textContent=position+' / '+(snapshots.length-1);
    $('eventType').textContent=e.type;$('eventTitle').textContent=e.title;$('eventDetail').textContent=e.detail;
    $('eventRoute').classList.toggle('hidden',!e.from);$('eventRoute').textContent=e.from?e.from+' → '+e.to:'';
    $('distinctCount').textContent=s.distinct.length;$('pathCount').textContent=coord.receivedResults;$('pendingCount').textContent=coord.expected===null?'?':coord.expected;
    const chips=s.distinct.length?[...s.distinct].sort().map(id=>'<span class="chip">'+esc(label(s,id))+'</span>').join(''):'<span class="empty">No unique results received.</span>';
    renderUserResponse(s);
    $('verification').classList.toggle('bad',s.complete&&!comparison.passed);
    const expectedNames=comparison.expected.distinct.map(id=>label(s,id)).join(', ')||'none';
    const actualNames=[...s.distinct].sort().map(id=>label(s,id)).join(', ')||'none';
    $('verification').innerHTML='<strong>'+(s.complete?(comparison.passed?'✓ PASS · answers match independent reference':'✕ FAIL · reference mismatch'):'✓ State invariants hold · query still running')+'</strong><div class="expected-answer">Oracle expected: '+esc(expectedNames)+' / '+comparison.expected.count+' path messages.<br>Actual received: '+esc(actualNames)+' / '+coord.receivedResults+' unique path messages.</div>';
    $('coordStatus').textContent=s.complete?'✓ QUERY COMPLETE':coord.phase.toUpperCase();
    const startingPerson=label(s,s.data.start);
    $('coordQuery').textContent=queryText(s.data);
    $('coordQuerySemantics').textContent=s.data.queryKind==='movies'?'Return title and year of movies linked from this actor; no unconnected movies.':s.data.queryKind==='restaurants'?'Scan cities, then collect selected fields from every linked restaurant.': 'From '+startingPerson+', follow outgoing follows edges for 1–'+s.data.maxHops+' hops. Return each reachable person once; exclude '+startingPerson+'.';
    $('coordQueryGap').textContent=s.data.queryKind==='restaurants'?'This WASM supports distance ordering only; rating order / top per city is not native ZQL. This query returns all candidates.':s.data.queryKind==='movies'?'Ten movie nodes are synthetic. Both executions use the same immutable fixture and exact displayed query.':'The lab additionally records every bounded walk; ZQL range traversal does not return those path records. Node identity is distinct from projected name.';
    $('coordDispatch').textContent='c1 → Server '+coord.dispatch.to+' · sent once';
    $('coordInboxSummary').textContent=coord.receivedResults+' / '+(coord.expected===null?'?':coord.expected)+' unique results';
    $('coordInbox').innerHTML='<li>'+coord.deliveries+' total incoming deliveries</li><li>'+coord.duplicateResults+' result retries + '+coord.duplicateRoots+' root retries ignored</li>';
    $('coordWork').textContent=coord.expected===null?'Expected count unknown':'rootDone expected '+coord.expected;
    $('coordBranches').textContent='Each child ACK contributes its subtree count once.';
    $('coordRoot').textContent='Root completion: '+(coord.rootDone?'received':'not received');
    $('coordWhy').textContent=coord.reason;
    $('coordResultLabel').textContent=coord.complete?'Final joined result:':'Partial result:';$('coordResults').innerHTML=chips;
    $('coordResultCount').textContent=s.distinct.length+' nodes / '+coord.receivedResults+' unique path messages';
    const cursors=Object.values(s.cursors);
    $('cursorCount').textContent=cursors.filter(c=>!['done','forwarded'].includes(c.pc)).length+' open / '+cursors.length+' work IDs';
    $('cursorTabs').innerHTML=cursors.map(c=>'<button class="cursor-tab '+(c.id===selected?'selected ':'')+(c.pc==='done'?'done':'')+'" aria-pressed="'+(c.id===selected)+'" data-cursor="'+c.id+'">'+esc(c.id)+'</button>').join('');
    const c=s.cursors[selected]||s.cursors.c1;
    const fields={State:phase[c.pc],Server:c.server,Epoch:'generation '+c.generation+' / operation '+c.op,Target:label(s,c.path.at(-1))+' (owner '+E.node(s.data,c.path.at(-1)).owner+')',Hops:(c.path.length-1)+' / '+s.data.maxHops,Parent:c.parent?c.parent+' @ '+c.parentServer:'coordinator',Own:c.ownCount+' emitted logical results',Children:c.children.length?Object.keys(c.childCounts).length+' / '+c.children.length+' joined · sum '+Object.values(c.childCounts).reduce((a,b)=>a+b,0):'none',Subtree:c.total===null?'not final':c.total,Sealed:c.sealed?'yes':'no'};
    $('inspector').innerHTML=Object.entries(fields).map(([key,value])=>'<dt>'+key+'</dt><dd>'+esc(value)+'</dd>').join('');$('cursorPath').textContent=E.names(s.data,c.path);
    const items=E.workItems(s),next=E.pick(s);
    const ordered=items.map((q,i)=>({q,i})).sort((a,b)=>a.i===next?-1:b.i===next?1:a.i-b.i);
    $('queueCount').textContent=items.length+' pending events';
    $('queue').innerHTML=ordered.length?ordered.map(({q},index)=>{
      let text,detail;
      if(q.kind==='run'){text=q.cursor+' · local operation';detail='Server '+q.server+' · '+q.id;}
      else {text=q.kind+(q.copy?' · retry copy':'');detail=q.from+' → '+q.to+' · '+q.id;if(['ack','rootDone'].includes(q.kind))detail+=' · count '+q.payload.count;}
      return '<li><span class="qnum">'+(index?'·':'→')+'</span><span class="qbody">'+esc(text)+'<span class="qdetail">'+esc(detail)+'</span></span></li>';
    }).join(''):'<li class="empty">All modeled traffic drained.</li>';
    $('history').innerHTML=s.history.length?[...s.history].reverse().map(h=>'<li><time>'+String(h.tick).padStart(2,'0')+'</time><span>'+esc(h.title)+'</span></li>').join(''):'<li class="empty">Step through dispatch, emissions, joins and receipts.</li>';
    $('pathSummary').textContent='Unique path results · '+s.received.length+' received · retries deduplicate by message ID; people deduplicate separately';
    $('pathList').innerHTML=s.received.length?s.received.map(r=>'<div class="path-row"><span>'+esc(r.cursor)+' / </span>'+esc(E.names(s.data,r.path))+'<br><span>'+esc(r.resultId)+'</span></div>').join(''):'<p class="empty">No qualifying path result received yet.</p>';
    protocolPanels(s);graph(s);renderExecutionTimeline(s);refreshResponseConnector();renderReference(s);
  }
  $('scenario').innerHTML = Object.entries(E.scenarios).map(([id, data]) => '<option value="' + id + '">' + data.name + '</option>').join('');
  $('schedule').innerHTML = Object.entries(E.schedules).map(([id, name]) => '<option value="' + id + '">' + name + '</option>').join('');
  $('executionGraph').addEventListener('click', selectExecutionEvent);
  $('executionGraph').addEventListener('keydown', event => { if(event.key==='Enter'||event.key===' '){ event.preventDefault();selectExecutionEvent(event); } });
  if(typeof window.addEventListener==='function')window.addEventListener('resize',refreshResponseConnector);
  $('runZega').addEventListener('click',runReference);
  $('scenario').addEventListener('change', reset); $('schedule').addEventListener('change', reset);
  $('step').addEventListener('click', () => { stop(); advance(); });
  $('back').addEventListener('click', () => { stop(); position = Math.max(0, position - 1); selected = state().event.cursor || 'c1'; render(); });
  $('reset').addEventListener('click', reset);
  $('play').addEventListener('click', () => { if (timer) stop(); else { advance(); if (!state().quiescent) { timer = setInterval(advance, 700); $('play').textContent = 'Ⅱ Pause'; } } });
  $('timeline').addEventListener('input', () => { stop(); position = Number($('timeline').value); selected = state().event.cursor || 'c1'; render(); });
  $('cursorTabs').addEventListener('click', e => { const id = e.target.dataset.cursor; if (id) { selected = id; render(); } });
  $('checks').addEventListener('click', () => {
    const lines = []; let passed = 0;
    for (const scenario of Object.keys(E.scenarios)) for (const schedule of Object.keys(E.schedules)) {
      try { let s = E.create(scenario, schedule); let guard = 0; while (!s.quiescent && guard++ < 2000) s = E.step(s); if (!s.quiescent || !E.comparison(s).passed) throw Error('reference mismatch or undrained traffic'); passed++; lines.push('PASS  ' + scenario.padEnd(8) + ' / ' + schedule.padEnd(6) + ' · ' + s.distinct.length + ' nodes, ' + s.received.length + ' paths, ' + s.tick + ' steps'); }
      catch (error) { lines.push('FAIL  ' + scenario + ' / ' + schedule + ' · ' + error.message); }
    }
    $('checkReport').classList.remove('hidden'); $('checkReport').textContent = passed + ' / ' + (Object.keys(E.scenarios).length*Object.keys(E.schedules).length) + ' reference checks passed. Invariants checked after every transition.\n' + lines.join('\n');
  });
  // Read-only diagnostics for local verification; the renderer never mutates engine state.
  window.CursorLabUI = Object.freeze({ getState: () => JSON.parse(JSON.stringify(state())), getPosition: () => position, getRecordedCount: () => snapshots.length, coordinatorUserResponse, coordinatorResponseJSON, responseChange, getReference:()=>JSON.parse(JSON.stringify(reference)),runReference, getExecutionTimeline: () => CursorTimeline.project(snapshots,state().tick), queryText });
  reset();
  // Reserve the actual floating-bar height when zoom or wrapping changes it.
  // CSS provides a conservative fallback before the first observation.
  if (typeof ResizeObserver === 'function') {
    const reservePlaybackSpace = () => {
      const height = $('playbackControls').getBoundingClientRect().height;
      document.documentElement.style.setProperty('--playback-reserve', Math.ceil(height) + 32 + 'px');
    };
    const playbackObserver = new ResizeObserver(reservePlaybackSpace);
    playbackObserver.observe($('playbackControls'));
  }
})();
