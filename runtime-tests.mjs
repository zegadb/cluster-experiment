import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {harness} from './ui-harness.cjs';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const ctx=vm.createContext({console,WebAssembly,TextDecoder,TextEncoder,atob,Uint8Array,Int32Array,Uint32Array,Float64Array,DataView,ArrayBuffer,window:{}});
let ready;
ctx.window.ZegaRuntime=new Promise((resolve,reject)=>{ctx.window.__resolveZega=resolve;ctx.window.__rejectZega=reject;});
const code=html.match(/<script id="zega-runtime" type="module">([\s\S]*?)<\/script>/)[1];
const module=new vm.SourceTextModule(code,{context:ctx,initializeImportMeta(meta){meta.url='file:///experiment/index.html';}});
await module.link(()=>{throw Error('No external runtime imports are permitted');});await module.evaluate();
ready=await ctx.window.ZegaRuntime;assert.equal(typeof ready.ZegaWasm,'function');
console.log('PASS Exact embedded module + WASM initializes in an isolated JS VM without imports or fetching.');
for(const scenario of ['chain','movies','restaurants','branch','diamond','wide','empty']){
 const h=harness(),{elements:el,click,state}=h;
 el.scenario.value=scenario;el.schedule.value='delayed';click('reset');h.sandbox.window.ZegaRuntime=Promise.resolve(ready);
 await h.sandbox.window.CursorLabUI.runReference();
 assert.equal(h.sandbox.window.CursorLabUI.getReference().status,'complete');assert(!el.wasmComparison.textContent.includes('MATCH'),'Partial simulation cannot match');
 // Rendering every recorded step is covered separately; complete the independent pure simulation here.
 while(!state().quiescent)click('step');
 assert(el.wasmComparison.textContent.startsWith('✓ MATCH'),el.wasmComparison.textContent);
 assert.equal(el.wasmResult.textContent,el.results.textContent);
 click('back');assert(!el.wasmComparison.textContent.includes('MATCH')||state().complete);
 el.scenario.value=scenario==='movies'?'chain':'movies';el.scenario.handlers.change();
 assert.equal(h.sandbox.window.CursorLabUI.getReference().status,'not-run');assert(!el.wasmComparison.textContent.includes('MATCH'));
 console.log('PASS Run Zega / '+scenario+' · independent current outputs, partial gating and scenario invalidation.');
}
{
 const h=harness();let resolve;
 h.sandbox.window.ZegaRuntime=new Promise(r=>resolve=r);
 const promise=h.sandbox.window.CursorLabUI.runReference();
 h.elements.scenario.value='movies';h.elements.scenario.handlers.change();resolve(ready);await promise;
 assert.equal(h.sandbox.window.CursorLabUI.getReference().status,'not-run');assert(!h.elements.wasmComparison.textContent.includes('MATCH'));
 console.log('PASS Pending runtime from old fixture is discarded after scenario switch.');
}
{
 const h=harness();h.sandbox.window.ZegaRuntime=Promise.reject(Error('intentional runtime load failure'));
 await h.sandbox.window.CursorLabUI.runReference();assert.equal(h.sandbox.window.CursorLabUI.getReference().status,'error');assert(h.elements.wasmResult.textContent.includes('intentional'));assert(!h.elements.wasmComparison.textContent.includes('MATCH'));
 console.log('PASS Runtime failure appears as a reference error and cannot produce a match.');
}
{
 const h=harness(),Q=h.sandbox.CursorQueries;
 assert.equal(Q.compare({rows:[1,2]},{rows:[2,1]}).match,false);
 assert.equal(Q.compare({a:1,b:2},{b:2,a:1}).match,true);
 assert(Q.compare({rows:[1]},{rows:[2]}).detail.includes('First difference'));
 console.log('PASS Structural comparison preserves array order and shows first differing JSON line.');
}
console.log('Runtime/UI tests use Node VM and a DOM harness. They do not establish browser layout, CSP, pointer behavior or console cleanliness.');
