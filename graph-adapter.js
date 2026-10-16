/* Canonical fixture -> four independent instances of the reused Zega canvas. */
(function(root){
'use strict';
const E=CursorLab;
function dataset(data,server){
 const ids=new Map(data.nodes.map((n,i)=>[n.id,i+1]));
 const owns=new Set(data.nodes.filter(n=>!server||n.owner===server).map(n=>n.id));
 const edges=data.edges.filter(([a,b])=>!server||owns.has(a)||owns.has(b));
 const included=new Set([...owns,...edges.flat()]);
 const nodes=data.nodes.filter(n=>included.has(n.id)).map(n=>({id:ids.get(n.id),labId:n.id,name:(server&&n.owner!==server?'↗ ':'')+(n.title||n.name),labels:[server&&n.owner!==server?'Remote reference → '+n.owner:n.kind||'Person'],owner:n.owner,ownerColor:E.servers[n.owner].color+'88',boundary:!!server&&!owns.has(n.id),...(n.rating===undefined?{}:{rating:n.rating}),...(n.year===undefined?{}:{year:n.year})}));
 const type=data.queryKind==='movies'?'movies':data.queryKind==='restaurants'?'restaurants':'follows';
 return {nodes,rels:edges.map(([a,b],i)=>({id:i+1,from:ids.get(a),to:ids.get(b),type}))};
}
let snapshot=null,selection=null,fixtureKey=null,graphs={},tab='three';
const $=id=>document.getElementById(id);
function render(s,selected){
 snapshot=s;selection=selected;
 const key=JSON.stringify(s.data);
 if(key!==fixtureKey){
  fixtureKey=key;graphs={all:dataset(s.data),A:dataset(s.data,'A'),B:dataset(s.data,'B'),C:dataset(s.data,'C')};
  for(const id of ['graphAll','graphA','graphB','graphC']){const el=$(id);root.CursorZegaGraph.stopSim(el);el._graph=null;}
 }
 const active=new Set(Object.values(s.cursors).filter(c=>!['done','forwarded'].includes(c.pc)).map(c=>c.path.at(-1)));
 if(s.event.node)active.add(s.event.node);
 const chosen=s.cursors[selected];if(chosen)for(const id of chosen.path)active.add(id);
 for(const id of s.event.edge||[])active.add(id);
 // Empty active set means all visible, rather than a fabricated execution highlight.
 const actions={onInspect:n=>{$('graphInspection').textContent=(n.boundary?'REMOTE REFERENCE · ':'OWNED DATA · ')+n.labId+' · '+n.name+' · owner Server '+n.owner+(n.rating===undefined?'':' · rating '+n.rating)+(n.year===undefined?'':' · year '+n.year);},onEdge:r=>{$('graphInspection').textContent='Directed '+r.type+' relationship · '+r.from+' → '+r.to+' (canonical fixture IDs in this canvas).';}};
 if(tab==='one')root.CursorZegaGraph.renderGraph($('graphAll'),graphs.all,active,actions);
 else for(const server of ['A','B','C']){
  $('owned'+server).textContent=s.data.nodes.filter(n=>n.owner===server).length+' owned';
  root.CursorZegaGraph.renderGraph($('graph'+server),graphs[server],active,actions);
 }
}
function setTab(next){
 tab=next;$('oneServer').hidden=next!=='one';$('threeServers').hidden=next!=='three';
 $('tabOne').setAttribute('aria-selected',String(next==='one'));$('tabThree').setAttribute('aria-selected',String(next==='three'));
 $('tabOne').setAttribute('tabindex',next==='one'?'0':'-1');$('tabThree').setAttribute('tabindex',next==='three'?'0':'-1');
 if(snapshot)render(snapshot,selection);
}
root.ClusterGraph=Object.freeze({render,dataset,setTab,getTab:()=>tab});
if(typeof document!=='undefined'){
 $('tabOne').addEventListener('click',()=>setTab('one'));$('tabThree').addEventListener('click',()=>setTab('three'));
 for(const [id,next]of [['tabOne','three'],['tabThree','one']])$(id).addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setTab(next);$(next==='one'?'tabOne':'tabThree').focus();}});
}
})(typeof window!=='undefined'?window:globalThis);
