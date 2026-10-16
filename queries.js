/* Fixed query plans and receipt-only projection. No WASM/oracle state is read by project(). */
(function(root){
'use strict';
const literal=value=>JSON.stringify(value);
function query(data){
 if(data.queryKind==='movies')return 'query {\n  Actor(name: "Robert Downey Jr.") {\n    movies -> Movie { title year }\n  }\n}';
 if(data.queryKind==='restaurants')return 'query {\n  City {\n    name\n    restaurants -> Restaurant { name rating }\n  }\n}';
 const start=data.nodes.find(n=>n.id===data.start).name;
 return 'query {\n  Person(name: '+literal(start)+') {\n    follows *1..'+data.maxHops+' -> Person(name != '+literal(start)+') { name }\n  }\n}';
}
function schema(data){
 if(data.queryKind==='movies')return 'type Actor { name: String movies -> Movie[] } type Movie { title: String year: Int }';
 if(data.queryKind==='restaurants')return 'type City { name: String restaurants -> Restaurant[] } type Restaurant { name: String rating: Float }';
 return 'type Person { name: String follows -> Person[] }';
}
function entries(data,control){
 const lookup=new Map(data.nodes.map((n,order)=>[n.id,{n,order}])),known=new Map();
 for(const r of Object.values(control.results)){
  const found=lookup.get(r.node);if(!found)throw Error('Unknown received node');
  const depth=r.path.length-1;
  if(!data.queryKind&&(depth<1||depth>data.maxHops||found.n.name===lookup.get(data.start).n.name))continue;
  const prior=known.get(r.node);
  if(!prior||depth<prior.depth)known.set(r.node,{id:r.node,name:found.n.name,depth,order:found.order,result:r});
 }
 return [...known.values()].sort((a,b)=>(data.queryKind?0:a.depth-b.depth)||a.order-b.order);
}
function project(data,control){
 const rows=entries(data,control);
 if(data.queryKind==='movies')return {movies:rows.map(e=>({title:e.result.row.title,year:e.result.row.year}))};
 if(data.queryKind==='restaurants')return rows.filter(e=>e.result.role==='City').map(city=>({name:city.result.row.name,restaurants:rows.filter(e=>e.result.role==='Restaurant'&&e.result.group===city.id).map(e=>({name:e.result.row.name,rating:e.result.row.rating}))}));
 return {follows:rows.map(e=>({name:e.name??null}))};
}
function change(data,before,after){
 const prior=entries(data,before),next=entries(data,after),ids=new Set(prior.map(e=>e.id));
 const changed=JSON.stringify(project(data,before))!==JSON.stringify(project(data,after));
 const added=changed?next.filter(e=>!ids.has(e.id)).map(e=>e.result.row||{name:e.name}):[];
 return {changed,added,reordered:changed&&!added.length};
}
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 return value;
}
function compare(sim,reference){
 const a=JSON.stringify(canonical(sim),null,2),b=JSON.stringify(canonical(reference),null,2);
 if(a===b)return {match:true,detail:'Exact selected values, nesting and array order match. Object key order is ignored.'};
 const x=a.split('\n'),y=b.split('\n');let i=0;while(x[i]===y[i]&&i<Math.max(x.length,y.length))i++;
 return {match:false,detail:'First difference at JSON line '+(i+1)+'\nSimulation: '+(x[i]??'(missing)')+'\nZega WASM: '+(y[i]??'(missing)')};
}
function run(ZegaWasm,data,source=query(data)){
 const db=new ZegaWasm(),shape=schema(data),ids=new Map();
 try{
  for(const n of data.nodes){
   const type=n.kind||'Person',props=type==='Movie'?{title:n.title,year:n.year}:type==='Restaurant'?{name:n.name,rating:n.rating}:{name:n.name};
   const args=Object.entries(props).map(([k,v])=>k+': '+literal(v)).join(' && ');
   const created=JSON.parse(db.run(shape,'mutation { '+type+'('+args+') { id } }'));
   ids.set(n.id,created.id);
  }
  const field=data.queryKind==='movies'?'movies':data.queryKind==='restaurants'?'restaurants':'follows';
  for(const [a,b]of data.edges)db.connect(shape,ids.get(a),field,ids.get(b));
  const checked=JSON.parse(db.check(shape,source));
  if(checked.diagnostics.length)throw Error(JSON.stringify(checked.diagnostics));
  return JSON.parse(db.run(shape,source));
 }finally{db.free();}
}
root.CursorQueries=Object.freeze({query,schema,entries,project,change,compare,run});
})(typeof globalThis!=='undefined'?globalThis:this);
