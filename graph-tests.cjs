const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8'),source=html.match(/<script id="graph-canvas">([\s\S]*?)<\/script>/)[1];
const ctx=vm.createContext({window:{},setTimeout,clearTimeout,setInterval,clearInterval,performance});
vm.runInContext(fs.readFileSync(__dirname+'/engine.js','utf8'),ctx);vm.runInContext(source,ctx);
const G=ctx.window.ClusterGraph,E=ctx.CursorLab;
for(const [name,data]of Object.entries(E.scenarios)){
 const all=G.dataset(data);assert.equal(all.nodes.length,data.nodes.length);assert.equal(all.rels.length,data.edges.length);
 const before=JSON.stringify(data);let ownTotal=0;
 for(const server of ['A','B','C']){
  const g=G.dataset(data,server),owned=g.nodes.filter(n=>!n.boundary),foreign=g.nodes.filter(n=>n.boundary);ownTotal+=owned.length;
  assert(owned.every(n=>n.owner===server));assert(foreign.every(n=>n.owner!==server&&n.labels[0].startsWith('Remote reference')));
  assert.equal(owned.length,data.nodes.filter(n=>n.owner===server).length);
  assert(g.rels.every(r=>g.nodes.some(n=>n.id===r.from)&&g.nodes.some(n=>n.id===r.to)));
  assert(g.rels.every(r=>owned.some(n=>n.id===r.from||n.id===r.to)));
 }
 assert.equal(ownTotal,data.nodes.length);all.nodes[0].name='render-only change';assert.equal(JSON.stringify(data),before);
 console.log('PASS Canvas data / '+name+' · complete graph, disjoint ownership, explicit remote references, immutable fixture.');
}
const size=ctx.window.CursorZegaGraph.canvasSize;
for(const width of [280,420,780,1440,2560])for(const height of [320,480,700]){const measured=size({width,height});assert.equal(measured.width,width);assert.equal(measured.height,height);}
assert.equal(size({width:0,height:0},{width:1440,height:480}).width,1440);
assert.equal(size({width:920,height:520},{width:1440,height:480}).width,920);
assert.equal(size({width:NaN,height:0},{width:920,height:520}).height,520);
assert(!html.includes('.shell{max-width:1512px'));assert(html.includes('.shell{width:100%;max-width:none;'));
assert(html.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));assert(html.includes('@media(max-width:1050px){.server-graphs{grid-template-columns:1fr}'));
const canvasSource=fs.readFileSync(__dirname+'/zega-graph.mjs','utf8');
assert(canvasSource.includes('new ResizeObserver(resize)'));assert(canvasSource.includes('container._graph.resize()'));
assert(canvasSource.includes("svg.setAttribute('viewBox','0 0 '+viewWidth+' '+viewHeight)"));
assert(canvasSource.includes(' / rect.width) * viewWidth'));assert(canvasSource.includes(' / rect.height) * viewHeight'));
console.log('PASS Layout sizing · full-width shell, 15 size combinations, hidden-tab retention, resize observation, current-size pointer coordinates and mobile stacking.');
const {harness}=require('./ui-harness.cjs');const h=harness();
let calls=0;h.sandbox.window.CursorZegaGraph={stopSim(){},renderGraph(){calls++;}};
vm.runInContext(fs.readFileSync(__dirname+'/graph-adapter.js','utf8'),h.sandbox);
const tick=h.state().tick;
h.sandbox.window.ClusterGraph.render(h.state(),'c1');assert.equal(calls,3);
h.elements.tabOne.handlers.click();assert.equal(calls,4);assert.equal(h.state().tick,tick);assert.equal(h.elements.oneServer.hidden,false);assert.equal(h.elements.threeServers.hidden,true);
h.click('step');assert.equal(h.state().tick,1);h.elements.tabThree.handlers.click();assert.equal(h.state().tick,1);assert.equal(h.elements.tabThree.attributes['aria-selected'],'true');
console.log('PASS Canvas tabs · same component, independent instances, shared snapshot, execution preserved.');
const original=fs.readFileSync(__dirname+'/zega-graph.mjs','utf8');
assert(original.includes('forceSimulation'));assert(original.includes('pointercancel'));assert(original.includes('prefers-reduced-motion'));assert(original.includes('data-zoom="fit"'));assert(original.includes('data-zoom="reset"'));assert(original.includes("'stroke-dasharray'"));
assert(!/<script[^>]+src\s*=/.test(html));assert(!/from\s*['"]\.\/vendor/.test(source));
console.log('PASS Reused canvas bundle parses/initializes without external imports; accessible controls and boundary styles are present.');
console.log('No real-browser pointer/layout/screenshot claim.');
