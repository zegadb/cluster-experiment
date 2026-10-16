/* Read-only projection of recorded snapshots. No execution, scheduler, or oracle. */
(function(root){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const receiptKinds=new Set(['result','rootDone']);
  function project(recorded,currentTick){
    if(!Number.isInteger(currentTick)||currentTick<0)throw Error('Timeline needs a visible recorded step');
    // Inspect only the tick of future records; never their event/cursor payloads.
    const states=recorded.filter(s=>s.tick<=currentTick).sort((a,b)=>a.tick-b.tick);
    if(!states.length||states.at(-1).tick!==currentTick)throw Error('Visible snapshot is missing');
    const lanes=[],byId={},events=[],forks=[],joins=[],executions={};
    function lane(c,tick){
      if(!c||byId[c.id])return;
      const value={id:c.id,parent:c.parent||null,parentServer:c.parentServer||null,birthTick:tick,finishTick:null,segments:[],current:null};
      lanes.push(value);byId[c.id]=value;
    }
    for(let i=0;i<states.length;i++){
      const s=states[i],before=states[i-1]||s,e=s.event;
      if(i===0)lane(s.cursors.c1,s.tick);
      if(e.type==='fork'){
        const parent=s.cursors[e.cursor];
        for(const childId of parent.children){
          lane(s.cursors[childId],s.tick);
          forks.push({tick:s.tick,parent:parent.id,child:childId});
        }
      }
      // Cursor state is already known at this snapshot, not inferred from a future fork.
      for(const c of Object.values(s.cursors))lane(c,s.tick);
      const message=e.messageId?s.logical[e.messageId]:null,p=message?.payload;
      const payloadCursor=typeof p?.cursor==='string'?p.cursor:p?.cursor?.id;
      const cursorId=e.cursor||payloadCursor||p?.child||null;
      const afterCursor=cursorId?s.cursors[cursorId]:null;
      const beforeCursor=cursorId?before.cursors[cursorId]:null;
      const original=e.type==='duplicate'&&e.messageKind==='run'?executions[e.messageId]:null;
      const eventPath=e.type==='follow'?(beforeCursor?.path||[]):p?.path||p?.cursor?.path||afterCursor?.path||beforeCursor?.path||[];
      const nodeId=original?.node||e.node||p?.node||eventPath.at(-1)||null;
      const depth=original?.depth??(nodeId?eventPath.lastIndexOf(nodeId):-1);
      const server=original?.server||(e.executionId?(e.from||beforeCursor?.server):e.to)||e.from||afterCursor?.server||'coordinator';
      const onCoordinator=e.type==='start'||(e.to==='coordinator'&&receiptKinds.has(e.messageKind||message?.kind));
      const marker=e.type==='duplicate'?'duplicate':e.type==='emit'?'emission':e.type==='fork'?'fork':e.type==='join'?'ack':
        ['dispatch','transfer','transfer-send'].includes(e.type)?'transfer':e.type==='finish'?'finish':onCoordinator?'receipt':'operation';
      const entry={tick:s.tick,type:e.type,marker,lane:onCoordinator?'@coordinator':cursorId||'@coordinator',cursor:cursorId,node:nodeId,
        depth:depth>=0?depth:null,server,from:e.from||null,to:e.to||null,title:e.title,detail:e.detail,
        messageKind:e.messageKind||message?.kind||null,messageId:e.messageId||null,executionId:e.executionId||null,
        status:afterCursor?.pc||'coordinator receipt',cursorServer:afterCursor?.server||null,generation:afterCursor?.generation??null,
        ownCount:afterCursor?.ownCount??null,childCounts:afterCursor?copy(afterCursor.childCounts):null,
        children:afterCursor?afterCursor.children.slice():null,subtreeCount:afterCursor?.total??null,
        expected:s.control.expected,received:Object.keys(s.control.results).length};
      events.push(entry);
      if(e.executionId)executions[e.executionId]=entry;
      if(e.type==='finish'&&byId[cursorId])byId[cursorId].finishTick=s.tick;
      if(e.type==='join'&&message?.kind==='ack'){
        const child=byId[p.child];
        if(!child||child.finishTick===null)throw Error('ACK lacks an earlier recorded child completion');
        joins.push({tick:s.tick,sourceTick:child.finishTick,parent:p.parent,child:p.child,count:p.count,from:e.from,to:e.to});
      }
      const end=states[i+1]?.tick??s.tick;
      for(const value of lanes){
        const c=s.cursors[value.id];if(!c)continue;
        value.current={server:c.server,status:c.pc,generation:c.generation,depth:c.path.length-1,node:c.path.at(-1),ownCount:c.ownCount,
          childCounts:copy(c.childCounts),children:c.children.slice(),subtreeCount:c.total};
        if(end<=s.tick)continue;
        const style=value.finishTick!==null?'messages':c.pc==='wait'?'waiting':['route','dispatch','forwarded'].includes(c.pc)?'inflight':'execution';
        const previous=value.segments.at(-1);
        if(previous&&previous.end===s.tick&&previous.server===c.server&&previous.style===style)previous.end=end;
        else value.segments.push({start:s.tick,end,server:c.server,style});
      }
    }
    return {currentTick,data:copy(states.at(-1).data),lanes,events,forks,joins,selected:events.at(-1),coordinator:{expected:states.at(-1).control.expected,received:Object.keys(states.at(-1).control.results).length}};
  }
  root.CursorTimeline=Object.freeze({project});
})(typeof globalThis!=='undefined'?globalThis:this);
