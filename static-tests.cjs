const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm');
const {handler}=require('./serve.cjs');
const root=__dirname,html=fs.readFileSync(root+'/index.html','utf8');
assert.equal(fs.readFileSync(root+'/dist/index.html','utf8'),html);
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))if(!match[1].includes('type="module"'))new vm.Script(match[2]);
const config=JSON.parse(fs.readFileSync(root+'/wrangler.jsonc','utf8'));assert.deepEqual(config.assets,{directory:'./dist'});assert(!config.routes&&!config.account_id&&!config.main);
function request(url){let status,headers,body;handler({url},{writeHead(s,h){status=s;headers=h;},end(x){body=x;}});return{status,headers,body};}
assert.equal(request('/').status,200);assert.equal(request('/index.html').body.toString(),html);assert(request('/').headers['Content-Type'].startsWith('text/html'));assert.equal(request('/../package.json').status,404);
const provenance=JSON.parse(fs.readFileSync(root+'/provenance.json','utf8'));
for(const asset of provenance.assets){const bytes=fs.readFileSync(root+'/'+asset.file);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.file);}
assert(!/\/Users\/[^/]+\//.test(html));assert(!/\/Users\/[^/]+\//.test(fs.readFileSync(root+'/vendor/zega_wasm_bg.wasm').toString('latin1')));
const before=crypto.createHash('sha256').update(html).digest('hex');require('node:child_process').execFileSync(process.execPath,[root+'/build.cjs']);const after=crypto.createHash('sha256').update(fs.readFileSync(root+'/index.html')).digest('hex');assert.equal(after,before);
console.log('PASS Static build · all classic scripts parse, output is deterministic and self-contained, provenance matches.');
console.log('PASS Static HTTP handler · serves only built index, correct type, rejects unrelated paths. No browser/network used.');
console.log('PASS Workers configuration · static assets only; no account, route, secret, domain or deployment.');
