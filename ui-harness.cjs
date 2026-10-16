const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const dir=__dirname,html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const engine=fs.readFileSync(path.join(dir,'engine.js'),'utf8'),timelineSource=fs.readFileSync(path.join(dir,'timeline.js'),'utf8'),querySource=fs.readFileSync(path.join(dir,'queries.js'),'utf8');
function harness(overrideData){
 const elements={},styles={};let resize,timerCallback;
 const make=id=>({id,innerHTML:'',textContent:'',value:'',disabled:false,height:80,handlers:{},classes:new Set(),
  attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){},getBoundingClientRect(){return this.rect||{height:this.height};},addEventListener(k,fn){this.handlers[k]=fn;},
  classList:{add(c){elements[id].classes.add(c);},remove(c){elements[id].classes.delete(c);},toggle(c,on){if(on)elements[id].classes.add(c);else elements[id].classes.delete(c);}}});
 for(const x of html.matchAll(/\bid="([^"]+)"/g))elements[x[1]]=make(x[1]);
 elements.scenario.value='chain';elements.schedule.value='fifo';
 const sandbox=vm.createContext({document:{getElementById:id=>{if(!elements[id])throw Error('Missing DOM ID '+id);return elements[id];},documentElement:{style:{setProperty:(k,v)=>styles[k]=v}}},console,
  window:{},setInterval:fn=>{timerCallback=fn;return 1;},clearInterval:()=>{timerCallback=null;},ResizeObserver:class{constructor(fn){resize=fn;}observe(){resize();}}});
 vm.runInContext(engine,sandbox);
 if(overrideData){const api=sandbox.CursorLab;sandbox.CursorLab=Object.freeze({...api,create:(scenario,schedule)=>api.create('test-fixture',schedule,overrideData)});}
 vm.runInContext(querySource,sandbox);vm.runInContext(timelineSource,sandbox);vm.runInContext(html.match(/<script id="simulation-ui">([\s\S]*?)<\/script>/)[1],sandbox);
 return{elements,sandbox,styles,resize:()=>resize(),playTick:()=>{if(timerCallback)timerCallback();},click:id=>elements[id].handlers.click({target:elements[id]}),state:()=>sandbox.window.CursorLabUI.getState(),timeline:()=>sandbox.window.CursorLabUI.getExecutionTimeline()};
}

module.exports={harness};
