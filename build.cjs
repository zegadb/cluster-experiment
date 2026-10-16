// Dependency-free static build: embeds the audited sources, D3 canvas and existing WASM.
const fs=require('node:fs'),path=require('node:path');
const dir=__dirname,read=name=>fs.readFileSync(path.join(dir,name),'utf8');
function bundleModule(source,imports={}){
 let code=source.replace(/\bimport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/gm,(_,names,file)=>'const {'+names.split(',').map(n=>n.trim().replace(/([\w$]+)\s+as\s+([\w$]+)/,'$1:$2')).join(',')+'}='+imports[file]+';');
 const exports=[];
 code=code.replace(/export function (\w+)/g,(_,name)=>{exports.push(name);return 'function '+name;});
 code=code.replace(/export\s*\{([^}]+)\};?/g,(_,names)=>{exports.push(...names.split(',').map(n=>n.trim().replace(/([\w$]+)\s+as\s+([\w$]+)/,'$2:$1')));return '';});
 if(/(^|\n)import\b|(^|\n)export\b/.test(code))throw Error('Unsupported module syntax');
 return '(function(){\n'+code+'\nreturn {'+exports.join(',')+'};\n})()';
}
let graph='/* Bundled existing D3 modules. Source/license provenance: THIRD_PARTY_NOTICES.md */\n';
for(const name of ['quadtree','dispatch','timer','force']){
 const imports={};for(const dependency of ['quadtree','dispatch','timer'])imports['./d3-'+dependency+'.js']='D3_'+dependency;
 graph+='const D3_'+name+'='+bundleModule(read('vendor/d3-'+name+'.js'),imports)+';\n';
}
graph+='window.CursorZegaGraph='+bundleModule(read('zega-graph.mjs'),{'./vendor/d3-force.js':'D3_force'})+';\n'+read('graph-adapter.js');
const wasm=fs.readFileSync(path.join(dir,'vendor/zega_wasm_bg.wasm')).toString('base64');
const runtime=read('vendor/zega_wasm.mjs')+'\ntry { const bytes=Uint8Array.from(atob("'+wasm+'"),c=>c.charCodeAt(0)); initSync({module:bytes}); window.__resolveZega({ZegaWasm}); } catch(error) { window.__rejectZega(error); }\n';
let html=read('index.html');
const sections={'simulation-engine':read('engine.js'),'cursor-ticks':read('tick-engine.js'),'tick-timeline':read('tick-timeline.js'),'execution-timeline':read('timeline.js'),'query-plans':read('queries.js'),'graph-canvas':graph,'simulation-ui':read('ui.js'),'zega-runtime':runtime};
for(const [id,code]of Object.entries(sections)){
 if(/<\/script/i.test(code))throw Error('Unexpected closing script tag in '+id);
 const pattern=new RegExp('(<script id="'+id+'"[^>]*>)[\\s\\S]*?(<\\/script>)');
 if(!pattern.test(html))throw Error('Missing '+id);
 html=html.replace(pattern,(_,open,close)=>open+'\n'+code+'\n'+close);
}
const css=read('graph.css')+'\n'+read('lab-additions.css');
if(!html.includes('id="canvas-styles"'))html=html.replace('</head>','<style id="canvas-styles"></style>\n</head>');
html=html.replace(/<style id="canvas-styles">[\s\S]*?<\/style>/,()=>'<style id="canvas-styles">\n'+css+'\n</style>');
if(!html.includes('id="runtime-ready"'))html=html.replace('<script id="zega-runtime"','<script id="runtime-ready">window.ZegaRuntime=new Promise((resolve,reject)=>{window.__resolveZega=resolve;window.__rejectZega=reject;});window.ZegaRuntime.catch(()=>{});</script>\n<script id="zega-runtime"');
const escape=value=>value.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const legal=read('THIRD_PARTY_NOTICES.md')+'\n\n'+read('LICENSE')+['force','quadtree','dispatch','timer'].map(name=>'\n\nD3 '+name+'\n'+read('licenses/d3-'+name+'.txt')).join('');
if(!html.includes('id="third-party-notices"'))html=html.replace('</footer>','<details id="third-party-notices"><summary>Licenses and provenance</summary><pre></pre></details></footer>');
html=html.replace(/<details id="third-party-notices">[\s\S]*?<\/details>/,()=>'<details id="third-party-notices"><summary>Licenses and provenance</summary><pre style="white-space:pre-wrap;font-size:10px;max-height:400px;overflow:auto">'+escape(legal)+'</pre></details>');
fs.writeFileSync(path.join(dir,'index.html'),html);
fs.mkdirSync(path.join(dir,'dist'),{recursive:true});
fs.writeFileSync(path.join(dir,'dist/index.html'),html);
console.log('Built self-contained index.html + dist/index.html ('+Buffer.byteLength(html)+' bytes). No network assets.');
