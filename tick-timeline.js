/* Tick-aware read-only timeline. Event context is captured when the bounded turn commits. */
(function(root){
'use strict';
const legacy=CursorTimeline,copy=x=>JSON.parse(JSON.stringify(x));
function project(recorded,currentTick,selectedId){
 if(!recorded[0]?.kernel)return legacy.project(recorded,currentTick);
 const states=recorded.filter(s=>s.tick<=currentTick).sort((a,b)=>a.tick-b.tick);
 if(!states.length||states.at(-1).tick!==currentTick)throw Error('Visible tick snapshot is missing');
 const lanes=[],byId={},events=[],forks=[],joins=[],executions={};
 function lane(c,tick){if(c&&!byId[c.id]){const l={id:c.id,parent:c.parent,parentServer:c.parentServer,birthTick:tick,finishTick:null,segments:[],current:null};byId[c.id]=l;lanes.push(l);}}
 for(let index=0;index<states.length;index++){
  const s=states[index];for(const c of Object.values(s.cursors))lane(c,s.tick);
  const source=s.tick===0?[{...s.event,eventId:'start',tick:0,context:{after:s.cursors.c1,path:s.cursors.c1.path,expected:null,received:0}}]:s.events;
  for(const e of source){
   const message=e.messageId?s.logical[e.messageId]:null,p=message?.payload,c=e.context?.after||null;
   const original=e.type==='duplicate'&&e.messageKind==='run'?executions[e.messageId]:null;
   const node=original?.node||e.node||p?.node||e.context?.path?.at(-1)||null;
   const onCoordinator=e.actor==='coordinator'||e.type==='start';
   const marker=e.type==='network'?'network':e.type==='duplicate'?'duplicate':e.type==='emit'?'emission':e.type==='fork'?'fork':e.type==='join'?'ack':
    ['dispatch','transfer','transfer-send'].includes(e.type)?'transfer':e.type==='finish'?'finish':onCoordinator?'receipt':'operation';
   const entry={tick:e.tick,eventId:e.eventId,type:e.type,marker,lane:onCoordinator?'@coordinator':e.cursor||'@coordinator',cursor:e.cursor||null,node,
    depth:original?.depth??(e.context?.path?.length?e.context.path.length-1:null),server:original?.server||e.to||e.actor?.split('/')[0]||c?.server||'coordinator',
    from:e.from||null,to:e.to||null,title:e.title,detail:e.detail,messageKind:e.messageKind||null,messageId:e.messageId||null,executionId:e.executionId||null,
    status:c?.pc||'inbox',cursorServer:c?.server||null,generation:c?.generation??null,ownCount:c?.ownCount??null,childCounts:c?copy(c.childCounts):null,
    children:c?c.children.slice():null,subtreeCount:c?.total??null,expected:e.context?.expected??null,received:e.context?.received??0};
   events.push(entry);if(e.executionId)executions[e.executionId]=entry;
   if(e.type==='fork')for(const child of c.children)forks.push({tick:s.tick,parent:c.id,child});
   if(e.type==='finish'&&byId[e.cursor])byId[e.cursor].finishTick=s.tick;
   if(e.type==='join'){
    const child=byId[p.child];if(!child||child.finishTick===null)throw Error('ACK has no completed child');
    joins.push({eventId:e.eventId,tick:s.tick,sourceTick:child.finishTick,parent:p.parent,child:p.child,count:p.count,from:e.from,to:e.to});
   }
  }
  const end=states[index+1]?.tick??s.tick;
  for(const l of lanes){
   const c=s.cursors[l.id];if(!c)continue;
   l.current={server:c.server,status:c.pc,generation:c.generation,depth:c.path.length-1,node:c.path.at(-1),ownCount:c.ownCount,childCounts:copy(c.childCounts),children:c.children.slice(),subtreeCount:c.total,role:c.children.length?'join record':'worker'};
   if(end<=s.tick)continue;
   const style=l.finishTick!==null?'messages':c.pc==='wait'?'waiting':['route','dispatch','forwarded'].includes(c.pc)?'inflight':'execution',previous=l.segments.at(-1);
   if(previous&&previous.end===s.tick&&previous.server===c.server&&previous.style===style)previous.end=end;
   else l.segments.push({start:s.tick,end,server:c.server,style});
  }
 }
 const final=states.at(-1);
 return {currentTick,data:copy(final.data),lanes,events,forks,joins,selected:events.find(e=>e.eventId===selectedId)||events.at(-1),coordinator:{expected:final.control.expected,received:Object.keys(final.control.results).length}};
}
root.CursorTimeline=Object.freeze({project});
})(typeof globalThis!=='undefined'?globalThis:this);
