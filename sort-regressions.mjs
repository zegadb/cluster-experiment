// Real native property sort, nested ranking and independent simulation aggregation regressions.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {initSync,ZegaWasm} from './vendor/zega_wasm.mjs';
initSync({module:fs.readFileSync(new URL('./vendor/zega_wasm_bg.wasm',import.meta.url))});
const ctx=vm.createContext({});for(const file of ['engine.js','queries.js'])vm.runInContext(fs.readFileSync(new URL('./'+file,import.meta.url),'utf8'),ctx);
const E=ctx.CursorLab,Q=ctx.CursorQueries,plain=x=>JSON.parse(JSON.stringify(x));
const schema='type Player { name: String salary: Int } type Team { name: String players -> Player[] }';
const db=new ZegaWasm();
try{
 const ids=[];
 for(const [name,salary]of [['Alice',12500000],['Bob',950000],['Cara',4000000]])ids.push(JSON.parse(db.run(schema,'mutation { Player(name: '+JSON.stringify(name)+' && salary: '+salary+') { @id } }')).id);
 const team=JSON.parse(db.run(schema,'mutation { Team(name: "Example") { @id } }'));
 for(const id of ids)db.connect(schema,team.id,'players',id);
 const exact='query { Player order by salary desc { name salary } }';
 assert.equal(JSON.parse(db.check(schema,exact)).diagnostics.length,0);
 const actual=JSON.parse(db.run(schema,exact));
 assert.deepEqual(actual,[{name:'Alice',salary:12500000},{name:'Cara',salary:4000000},{name:'Bob',salary:950000}]);
 console.log('PASS Exact user query: '+exact+' => '+JSON.stringify(actual));
 const nested='query { Team { name players -> Player order by salary desc, name limit 1 { name salary } } }';
 assert.equal(JSON.parse(db.check(schema,nested)).diagnostics.length,0);
 assert.deepEqual(JSON.parse(db.run(schema,nested)),[{name:'Example',players:[{name:'Alice',salary:12500000}]}]);
 console.log('PASS Native nested property sort + secondary key + limit.');
}finally{db.free();}
function reference(data){
 return data.nodes.filter(n=>n.kind==='City').map(city=>{
  let best=null,bestOrder=-1;
  for(const [from,to]of data.edges)if(from===city.id){const order=data.nodes.findIndex(n=>n.id===to),n=data.nodes[order];
   if(!best||n.rating>best.rating||(n.rating===best.rating&&(n.name<best.name||(n.name===best.name&&order<bestOrder)))){best=n;bestOrder=order;}
  }
  return {name:city.name,restaurants:best?[{name:best.name,rating:best.rating}]:[]};
 });
}
let steps=0,firstArrivalCounterexamples=0;
for(const schedule of Object.keys(E.schedules)){
 let s=E.create('restaurants',schedule);const expected=Q.run(ZegaWasm,s.data),beforeFixture=JSON.stringify(E.scenarios.restaurants);
 assert.deepEqual(plain(expected),plain(reference(s.data)));
 while(!s.quiescent){
  const old=s;s=E.step(s);steps++;
  const groups=Q.restaurantGroups(s.data,s.control),response=Q.project(s.data,s.control),change=Q.change(s.data,old.control,s.control);
  assert.equal(change.changed,JSON.stringify(response)!==JSON.stringify(Q.project(s.data,old.control)));
  for(const [i,g]of groups.entries()){
   assert(g.received<=g.expected);
   if(!g.ready){assert.equal(g.winner,null);assert.equal(response[i].restaurants.length,0);}
   else{assert.equal(g.received,g.expected);assert.deepEqual(plain(response[i]),plain(expected).find(c=>c.name===g.name));}
   if(g.received===1&&!g.ready){const first=Object.values(s.control.results).find(r=>r.role==='Restaurant'&&r.group===g.id);if(first&&first.row.name!==plain(expected).find(c=>c.name===g.name).restaurants[0].name)firstArrivalCounterexamples++;}
  }
  if(s.event.type==='duplicate')assert.equal(change.changed,false);
 }
 assert(E.comparison(s).passed);assert.equal(s.control.expected,55);assert.deepEqual(plain(Q.project(s.data,s.control)),plain(expected));assert.equal(JSON.stringify(E.scenarios.restaurants),beforeFixture);
 console.log('PASS Top per city / '+schedule+' · complete groups only, independent fold oracle, native WASM parity; 55 protocol results -> 5 ranked rows.');
}
assert(firstArrivalCounterexamples>0);
{
 const d=plain(E.scenarios.restaurants);const one=d.nodes.find(n=>n.id==='r0_2'),two=d.nodes.find(n=>n.id==='r0_9');
 assert.equal(one.rating,two.rating);assert(two.name<one.name);
 let s=E.create('tie','duplicates',d);while(!s.quiescent)s=E.step(s);
 assert.equal(Q.restaurantGroups(d,s.control).find(g=>g.id==='city0').winner.id,two.id);
 one.name=two.name='Same top name';one.id='z-first-created';two.id='a-later-created';d.edges=d.edges.map(([a,b])=>[a,b==='r0_2'?one.id:b==='r0_9'?two.id:b]);
 s=E.create('stable-tie','delayed',d);while(!s.quiescent)s=E.step(s);
 assert.equal(Q.restaurantGroups(d,s.control).find(g=>g.id==='city0').winner.id,'z-first-created');
 assert.deepEqual(plain(Q.project(d,s.control)),plain(Q.run(ZegaWasm,d)));
 console.log('PASS Rating ties use name; identical selected values retain creation order rather than lexical fixture ID.');
}
console.log('PASS '+steps+' ranking transitions checked; first-arrival counterexamples observed. No oracle results feed the simulation.');
console.log('Dependency cause: old 0.1.2 artifact rejected both root/nested property sort; official 0.2.0 accepts both. No syntax workaround, production engine edit or Rust build.');
