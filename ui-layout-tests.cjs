const fs=require('node:fs'),assert=require('node:assert/strict'),{harness}=require('./ui-harness.cjs');
const h=harness(),{elements:el}=h,geometry=h.sandbox.window.CursorLabUI.connectorGeometry;
const grid={left:20,top:40,width:1800,height:1100},source={left:1240,right:1600,bottom:500},outbox={left:1254,right:1586},target={left:1240,right:1600,top:512},flow={left:1254,right:1586};
const r=geometry(grid,source,outbox,target,flow);
assert.equal(r.x1,1400);assert.equal(r.x1,r.x2);assert.equal(r.y1,461);assert.equal(r.y2,469);assert.equal(r.path,'M 1400 461 V 469');
assert(r.y1>source.bottom-grid.top&&r.y2<target.top-grid.top);assert(r.x1>outbox.left-grid.left&&r.x1<outbox.right-grid.left);
for(const offset of [0,120,450]){
 const shifted=geometry({...grid,top:grid.top-offset},{...source,bottom:source.bottom-offset},outbox,{...target,top:target.top-offset},flow);
 assert.deepEqual(shifted,r,'page scroll must not alter relative route');
}
for(const bad of [{...target,top:505},{...target,left:300,right:700}])assert.equal(geometry(grid,source,outbox,bad,flow),null);
assert.equal(geometry({...grid,width:0},source,outbox,target,flow),null);assert.equal(geometry(grid,{...source,bottom:NaN},outbox,target,flow),null);
console.log('PASS Connector routing · coordinator and JSON share a column; fixed arrow stays wholly inside the empty row gap; scroll-invariant anchors; overlap/invalid geometry rejected.');
for(const [id,rect]of Object.entries({mainGrid:grid,coordinatorServer:source,coordOutbox:outbox,userResponsePanel:target,responseFlow:flow}))el[id].rect=rect;
h.sandbox.window.listeners.resize();
assert(el.responseConnector.innerHTML.includes('markerUnits="userSpaceOnUse"'));assert(el.responseConnector.innerHTML.includes('markerWidth="7"'));assert(el.responseConnector.innerHTML.includes('coordinator-to-json-row-gap'));assert(el.responseConnector.innerHTML.includes('cy="461"'));
el.userResponsePanel.rect={...target,top:530};h.sandbox.window.listeners['cluster-graph-viewchange']();assert(el.responseConnector.innerHTML.includes('V 487'));
el.userResponsePanel.rect={left:800,right:1100,top:530};h.sandbox.window.listeners.resize();assert.equal(el.responseConnector.innerHTML,'');
console.log('PASS Connector refresh · viewport/tab notifications recompute current row bounds; cross-column routes hide; fixed-size open arrowhead.');
const html=fs.readFileSync(__dirname+'/index.html','utf8'),css=fs.readFileSync(__dirname+'/lab-additions.css','utf8');
const markup=html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style[^>]*>[\s\S]*?<\/style>/g,'');
const nodes=[],stack=[],voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for(const m of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g)){
 const tag=m[2].toLowerCase();
 if(m[1]){assert.equal(stack.pop()?.tag,tag,'balanced HTML close '+tag);continue;}
 const attrs=m[3],node={tag,attrs,id:attrs.match(/\bid="([^"]+)"/)?.[1],parent:stack.at(-1)||null};nodes.push(node);if(!voidTags.has(tag)&&!attrs.trimEnd().endsWith('/'))stack.push(node);
}
assert.equal(stack.length,0);const id=name=>nodes.find(n=>n.id===name);
assert.deepEqual(nodes.filter(n=>n.parent?.id==='mainGrid').map(n=>n.id),['querySection','graphPanel','coordinatorServer','executionPanel','userResponsePanel','responseConnector']);
assert.equal(id('graphA').parent.parent,id('graphB').parent.parent);assert.equal(id('graphB').parent.parent,id('graphC').parent.parent);
assert.deepEqual(nodes.filter(n=>n.parent===id('graphA').parent.parent).map(n=>n.id||nodes.find(c=>c.parent===n&&c.id)?.id),['graphA','graphB','graphC']);
assert.equal(id('responseChangeDetail').parent.tag,'details');assert.equal(id('verification').parent,id('responseChangeDetail').parent);
assert.equal(id('executionDetailPanel').tag,'details');assert.equal(id('executionDetailPanel').parent.id,'executionPanel');assert(!id('executionDetailPanel').attrs.includes(' open'));
assert.equal(id('currentEventPanel').parent.attrs.trim(),'class="process-row"');
assert(css.includes('grid-template-areas:"query query" "graph coordinator" "timeline result"'));
assert(css.includes('grid-template-columns:minmax(0,3fr) minmax(280px,1fr)'));
for(const selector of ['.graph-panel{grid-area:graph;height:var(--overview-height)}','#coordinatorServer{grid-area:coordinator;height:var(--overview-height)}','#executionPanel{grid-area:timeline;height:var(--response-row-height)}','#userResponsePanel{grid-area:result;height:var(--response-row-height)}'])assert(css.includes(selector),selector);
assert(css.includes('.graph-views>div{height:100%;display:flex;flex-direction:column}'));assert(css.includes('.zega-graph .graph-wrap svg{height:100%}'));
assert(css.includes('@media(max-width:700px)'));assert(css.includes('.process-row{grid-template-columns:minmax(0,1fr)}'));
console.log('PASS Main overview · strict balanced DOM; query spans page; A/B/C next to coordinator; timeline next to JSON; aligned bounded row heights, measured canvases and narrow-screen stacking.');
assert(html.includes('id="currentEventPanel" tabindex="0"'));assert(css.includes('#currentEventPanel{height:260px;min-height:260px;max-height:260px;overflow:auto;scrollbar-gutter:stable;'));
assert(css.includes('#currentEventPanel{height:280px;min-height:280px;max-height:280px}'));assert(css.includes('.response-connector{opacity:0}'));
assert(css.includes('#userResponsePanel .response-flow{flex:none;border-width:2px;'));assert(css.includes('#userResponsePanel .received-json{flex:1;min-height:80px;'));
for(let i=0;i<17;i++){h.click('step');assert(!el.fatal.textContent);}
const marker={dataset:{executionStep:'8'},closest(){return this;}};el.executionGraph.handlers.click({target:marker});assert.equal(h.state().tick,8);assert.equal(el.executionDetailPanel.open,true);
console.log('PASS Playback and inspection · fixed scrollable tick panel, reserved border widths, all 17 tick transitions and event selection opening the compact detail disclosure.');
console.log('Geometry/DOM/CSS checks; real-browser screenshot verification is reported separately.');
