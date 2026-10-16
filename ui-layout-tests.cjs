const fs=require('node:fs'),assert=require('node:assert/strict'),{harness}=require('./ui-harness.cjs');
const h=harness(),{elements:el}=h,geometry=h.sandbox.window.CursorLabUI.connectorGeometry;
const grid={left:20,top:40,width:1800,height:1500},source={right:1200,top:180,height:340},outbox={top:470,height:20},target={left:1240},flow={top:300,height:42};
const r=geometry(grid,source,outbox,target,flow);
assert.equal(r.x1,1182);assert.equal(r.y1,440);assert.equal(r.x2,1217);assert.equal(r.y2,281);
assert(r.lane>r.x1&&r.lane<r.x2);assert(r.path.includes(' V '));assert(r.path.includes(' Q '));assert(!r.path.includes(' C '));
for(const top of [210,400,760]){const a=geometry(grid,source,{top,height:20},target,flow);assert(a.y1>=source.top+8-grid.top);assert(a.y1<=source.top+source.height-8-grid.top);assert.equal(a.y2,281);}
assert.equal(geometry(grid,source,outbox,{left:900},flow),null);assert.equal(geometry({...grid,width:0},source,outbox,target,flow),null);
console.log('PASS Connector routing · actual coordinator-result and update-banner anchors; gutter-only rounded path; stacked/invalid layouts hide it.');
for(const [id,rect]of Object.entries({mainGrid:grid,coordinatorServer:source,coordResultLabel:outbox,userResponsePanel:target,responseFlow:flow}))el[id].rect=rect;
h.sandbox.window.listeners.resize();
assert(el.responseConnector.innerHTML.includes('markerUnits="userSpaceOnUse"'));assert(el.responseConnector.innerHTML.includes('markerWidth="7"'));assert(el.responseConnector.innerHTML.includes('gutter-to-update-banner'));assert(el.responseConnector.innerHTML.includes('cy="440"'));
el.responseFlow.rect={top:600,height:42};h.sandbox.window.listeners['cluster-graph-viewchange']();assert(el.responseConnector.innerHTML.includes('581'));
el.userResponsePanel.rect={left:800};h.sandbox.window.listeners.resize();assert.equal(el.responseConnector.innerHTML,'');
console.log('PASS Connector refresh · window/tab notifications recompute current bounds and hide overlapping layouts; arrowhead size is independent of stroke.');
const html=fs.readFileSync(__dirname+'/index.html','utf8'),css=fs.readFileSync(__dirname+'/lab-additions.css','utf8');
assert(html.includes('id="currentEventPanel" tabindex="0"'));assert(css.includes('#currentEventPanel{height:260px;min-height:260px;max-height:260px;overflow:auto;scrollbar-gutter:stable;'));
assert(css.includes('#currentEventPanel{height:280px;min-height:280px;max-height:280px}'));assert(css.includes('.response-connector{opacity:0}'));
for(let i=0;i<17;i++){h.click('step');assert(!el.fatal.textContent);assert(el.currentEventPanel);}
console.log('PASS Current event · stable fixed desktop/mobile sizes, internal keyboard scrolling, wrapping and preserved playback.');
console.log('These geometry/DOM checks do not replace real-browser layout verification.');
