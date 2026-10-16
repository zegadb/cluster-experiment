// Optional development file server. The experiment itself needs no backend.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'dist');
const port=Number(process.env.PORT||4173);
function handler(req,res){
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname!=='/'&&pathname!=='/index.html'){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
 try{const body=fs.readFileSync(path.join(root,'index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(503,{'Content-Type':'text/plain'});res.end('Run npm run build first.');}
}
module.exports={handler};
if(require.main===module)http.createServer(handler).listen(port,'127.0.0.1',()=>console.log('Cursor Lab: http://127.0.0.1:'+port));
