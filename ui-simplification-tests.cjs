const fs=require('node:fs'),assert=require('node:assert/strict'),{harness}=require('./ui-harness.cjs');
const html=fs.readFileSync(__dirname+'/index.html','utf8'),css=fs.readFileSync(__dirname+'/lab-additions.css','utf8');
const markup=html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style[^>]*>[\s\S]*?<\/style>/g,'');
const nodes=[],stack=[],voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for(const match of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g)){
 const tag=match[2].toLowerCase();
 if(match[1]){while(stack.length){if(stack.pop().tag===tag)break;}continue;}
 const attrs=match[3],node={tag,attrs,id:attrs.match(/\bid="([^"]+)"/)?.[1],parent:stack.at(-1)||null};nodes.push(node);
 if(!voidTags.has(tag)&&!attrs.trimEnd().endsWith('/'))stack.push(node);
}
const byId=id=>nodes.find(n=>n.id===id),ancestor=(node,id)=>{while(node){if(node.id===id)return true;node=node.parent;}return false;};
assert.equal(nodes.find(n=>n.tag==='section').id,'querySection');assert(ancestor(byId('coordQuery'),'querySection'));
assert.equal((markup.match(/>THE QUERY</g)||[]).length,1);assert(markup.includes('<h1 id="queryHeading">THE QUERY</h1>'));
assert(!nodes.some(n=>n.tag==='header'));assert(!markup.includes('Follow the cursor.'));assert(!markup.includes('ZEGA / CURSOR LAB'));assert(!markup.includes('The data'));
for(const id of ['query','semantics','scenarioDescription','hopBound'])assert(!byId(id));
for(const id of ['coordQuery','tabOne','tabThree','graphAll','graphA','graphB','graphC','coordinatorServer','userResponsePanel','executionGraph','currentEventPanel','scheduleNote','linkQueues','serverStates','runZega'])assert(byId(id),id);
console.log('PASS Page simplification · first section is THE QUERY with real ZQL; hero and duplicate summary removed; graph/result/timeline/diagnostic panels preserved.');
for(const id of ['scenario','schedule']){assert.equal(nodes.filter(n=>n.id===id).length,1);assert(ancestor(byId(id),'playbackControls'));assert.equal(byId(id).tag,'select');}
assert.equal(byId('scenario').parent.parent,byId('schedule').parent.parent);assert(byId('scenario').parent.parent.attrs.includes('floating-selectors'));
assert(markup.includes('<label for="scenario">SCENARIO</label>'));assert(markup.includes('<label for="schedule">NETWORK DELIVERY</label>'));
assert(markup.indexOf('id="scenario"')<markup.indexOf('id="schedule"'));assert(!markup.includes('Delivery order'));
const h=harness(),{elements:el,click,state}=h;
el.scenario.value='movies';el.scenario.handlers.change();assert.equal(state().scenario,'movies');assert.equal(state().tick,0);
for(const schedule of ['fifo','lifo','cfirst','delayed','duplicates','seeded']){
 click('play');assert(state().tick>0);el.schedule.value=schedule;el.schedule.handlers.change();
 assert.equal(state().tick,0);assert.equal(state().schedule,schedule);assert.equal(state().scenario,'movies');assert.equal(el.play.textContent,'▶ Play');
 assert.equal(h.sandbox.window.CursorLabUI.getRecordedCount(),1);assert.equal(h.sandbox.window.CursorLabUI.getReference().status,'not-run');assert.equal(el.wasmResult.textContent,'Run Zega to execute the displayed ZQL.');assert(!el.fatal.textContent);
}
console.log('PASS Floating selectors · exact labels, adjacent shared group, single instances; scenario/network changes stop playback, reset execution and invalidate reference.');
assert(css.includes('.floating-selectors{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)'));
assert(css.includes('max-width:100%;min-width:0'));assert(css.includes('.floating-field{min-width:0;text-align:left}'));
assert(css.includes('.floating-field select{display:block;width:100%;min-width:0;min-height:44px;'));
assert(css.includes('@media(max-width:620px){.floating-selectors{flex:1 1 100%;width:100%;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}'));
for(const height of [88,146.2,212,280,340]){el.playbackControls.height=height;h.resize();assert.equal(h.styles['--playback-reserve'],Math.ceil(height)+32+'px');}
console.log('PASS Responsive controls · shrinking grid columns, mobile row wrapping, 44px selects and measured bottom clearance across five bar heights.');
console.log('DOM/CSS checks only; real-browser visual verification remains unavailable.');
