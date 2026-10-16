// Verify exact selected-field responses using the bundled existing Zega WASM, in memory.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {initSync,ZegaWasm} from './vendor/zega_wasm.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
initSync({module:fs.readFileSync(path.join(dir,'vendor/zega_wasm_bg.wasm'))});
const context=vm.createContext({});
for(const name of ['engine.js','queries.js'])vm.runInContext(fs.readFileSync(path.join(dir,name),'utf8'),context);
const E=context.CursorLab,Q=context.CursorQueries,plain=x=>JSON.parse(JSON.stringify(x));
const verified={runtime:'Bundled zega-wasm 0.1.2; exact asset hashes in provenance.json',cases:{}};
for(const [key,data]of Object.entries(E.scenarios)){
 const source=Q.query(data),actual=Q.run(ZegaWasm,data,source);
 for(const schedule of Object.keys(E.schedules)){
  let s=E.create(key,schedule),guard=0;while(!s.quiescent&&guard++<5000)s=E.step(s);
  assert(s.quiescent);assert(E.comparison(s).passed);assert.deepEqual(plain(Q.project(data,s.control)),plain(actual),key+'/'+schedule);
 }
 verified.cases[key]={query:source,response:actual};
 console.log('PASS '+key+' · exact response nesting, selected fields and array order under all six schedules.');
 console.log(JSON.stringify(actual));
}
for(const [key,data]of [
 ['escapedSelectedName',(()=>{const d=plain(E.scenarios.chain);d.nodes[1].name='Ben "B" \\ <b>&friend</b>\n\t';return d;})()],
 ['sameProjectedName',{name:'same names',description:'same selected value on distinct nodes',start:'ava',maxHops:2,nodes:[{id:'ava',name:'Ava',owner:'A'},{id:'one',name:'Same',owner:'B'},{id:'two',name:'Same',owner:'C'}],edges:[['ava','one'],['ava','two']]}]
]){
 const actual=Q.run(ZegaWasm,data);let s=E.create(key,'duplicates',data);while(!s.quiescent)s=E.step(s);
 assert.deepEqual(plain(Q.project(data,s.control)),plain(actual));verified.cases[key]={query:Q.query(data),response:actual};
 console.log('PASS '+key+' · literal values and identity distinctness.');
}
const db=new ZegaWasm();try{
 const source='query { City { name restaurants -> Restaurant order by rating desc limit 1 { name rating } } }';
 const check=JSON.parse(db.check(Q.schema(E.scenarios.restaurants),source));
 assert(check.diagnostics.length>0);console.log('CONFIRMED LIMITATION · native rating order rejected: '+JSON.stringify(check.diagnostics));
}finally{db.free();}
fs.writeFileSync(path.join(dir,'verified-zql-responses.json'),JSON.stringify(verified,null,2)+'\n');
console.log('All graphs were ephemeral in-memory instances. No production repository or database changes.');
