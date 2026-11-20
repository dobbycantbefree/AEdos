// A-Dos alpha shared-file proof-of-concept. No OpenAI API calls, no paid fallback.
// Node.js 20+, no external packages. Only for fictional, non-sensitive test documents.
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const url=require('node:url');
const ROOT=__dirname;
const DATA=process.env.ADOS_DATA_DIR||path.join(ROOT,'data');
const FILES=path.join(DATA,'uploads');
fs.mkdirSync(FILES,{recursive:true});
const DBFILE=path.join(DATA,'records.json');
if(process.env.NODE_ENV==='production'&&(!process.env.ADOS_ALPHA_PASSWORD||!process.env.ADOS_ADMIN_PASSWORD))throw Error('Set ADOS_ALPHA_PASSWORD and ADOS_ADMIN_PASSWORD for production');
const USERS=Object.fromEntries([['admin',process.env.ADOS_ADMIN_PASSWORD||'admin'],['demo',process.env.ADOS_ALPHA_PASSWORD||'demo'],...Array.from({length:4},(_,i)=>['tester'+(i+1),process.env.ADOS_ALPHA_PASSWORD||'alpha1234'])]);
const sessions=new Map();
const maxFileBytes=10*1024*1024;
let db;
try {db=JSON.parse(fs.readFileSync(DBFILE,'utf8'))}catch{db={files:[]}}
function persist(){let tmp=DBFILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DBFILE)}
function send(res,status,body,headers={}){let data=typeof body==='string'?body:JSON.stringify(body);res.writeHead(status,{'Content-Type':typeof body==='string'?'text/plain; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(data)}
async function jsonBody(req){let bufs=[],n=0;for await(const b of req){n+=b.length;if(n>15*1024*1024)throw Object.assign(new Error('Too large'),{status:413});bufs.push(b)}return JSON.parse(Buffer.concat(bufs).toString('utf8'))}
function authed(req){let m=/(?:^|;\s*)ados_session=([^;]+)/.exec(req.headers.cookie||'');return m?sessions.get(m[1]):null}
function authError(res){send(res,401,{error:'Login required'})}
function id(){return crypto.randomBytes(16).toString('hex')}
function safeName(n){return path.basename(String(n||'file')).replace(/[\\/\0\r\n]/g,'_').slice(0,160)}
function words(q){return [...new Set(String(q).toLowerCase().replace(/[^\p{L}\p{N} ]/gu,' ').split(/\s+/).filter(x=>x.length>1))]}
function findQuotes(project,q){let terms=words(q),hits=[];for(let f of db.files){if(f.project!==project||!f.text)continue;let segments=f.text.split(/(?<=[.!?\n。])\s+|\n+/).filter(x=>x.trim().length>7);for(let part of segments){let text=(f.name+' '+part).toLowerCase(),score=terms.filter(w=>text.includes(w)).length;if(score>0)hits.push({name:f.name,part:part.slice(0,420),score})}}hits.sort((a,b)=>b.score-a.score);return hits.slice(0,5)}
const server=http.createServer(async(req,res)=>{
 const uri=new URL(req.url,'http://localhost');const route=uri.pathname;
 if(req.method==='GET'&&(route==='/'||route==='/index.html')){let html=fs.readFileSync(path.join(ROOT,'index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(html)}
 if(route==='/api/health'&&req.method==='GET')return send(res,200,{shared:true,ai:'unavailable_pending_approval',billing_fallback:false});
 if(route==='/api/login'&&req.method==='POST'){
  try{let body=await jsonBody(req),name=body.user,pw=body.password;
    if(typeof name!=='string'||typeof pw!=='string'||!Object.hasOwn(USERS,name)||!crypto.timingSafeEqual(crypto.createHash('sha256').update(pw).digest(),crypto.createHash('sha256').update(USERS[name]).digest()))return send(res,401,{error:'Invalid credentials'});
    let token=id();sessions.set(token,name);return send(res,200,{user:name},{'Set-Cookie':`ados_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV==='production'?'; Secure':''}`});
  }catch{return send(res,400,{error:'Invalid request'})}
 }
 if(route==='/api/logout'&&req.method==='POST'){let m=/(?:^|;\s*)ados_session=([^;]+)/.exec(req.headers.cookie||'');if(m)sessions.delete(m[1]);return send(res,200,{ok:true},{'Set-Cookie':'ados_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})}
 const user=authed(req);if(!user)return authError(res);
 if(route==='/api/chatgpt/status'&&req.method==='GET')return send(res,200,{connected:false,reason:'OpenAI approval / OAuth backend not configured',paid_api_fallback:false});
 if(route==='/api/files'&&req.method==='GET')return send(res,200,{files:db.files.filter(x=>x.project==='ces27').map(({id,name,text,tag,by,created,mime})=>({id,name,content:text.slice(0,30000),tag,by,date:created,mime,enabled:true,remote:true}))});
 if(route==='/api/files'&&req.method==='POST'){
  try{let b=await jsonBody(req);if(b.project!=='ces27')return send(res,403,{error:'Project inaccessible'});
   if(!b.name||typeof b.base64!=='string')return send(res,400,{error:'Invalid file'});
   let bytes=Buffer.from(b.base64,'base64');if(!bytes.length||bytes.length>maxFileBytes)return send(res,413,{error:'Max file size: 10 MB'});
   let name=safeName(b.name),ext=path.extname(name).toLowerCase();let content=/^(\.txt|\.md|\.csv)$/.test(ext)?bytes.toString('utf8').slice(0,500000):'';
   let fid=id(),stored=path.join(FILES,fid);fs.writeFileSync(stored,bytes,{flag:'wx',mode:0o600});let item={id:fid,project:'ces27',name,mime:String(b.mime||''),tag:'Others',by:user,created:new Date().toISOString(),text:content};db.files.unshift(item);persist();return send(res,201,{file:{id:fid,name,content,tag:item.tag,by:user,date:item.created,enabled:true,remote:true}});
  }catch(e){return send(res,e.status||400,{error:e.message||'Upload failed'})}
 }
 if(route.startsWith('/api/file/')&&req.method==='GET'){
   let fid=route.split('/').pop();let f=db.files.find(x=>x.id===fid&&x.project==='ces27');if(!f)return send(res,404,{error:'Not found'});
   let file=path.join(FILES,fid);if(!fs.existsSync(file))return send(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,'X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).pipe(res)
 }
 if(route==='/api/ask'&&req.method==='POST'){
  try{let b=await jsonBody(req);if(b.project!=='ces27')return send(res,403,{error:'Project inaccessible'});let q=String(b.question||'').slice(0,1000);if(!q.trim())return send(res,400,{error:'Question required'});
   let hits=findQuotes('ces27',q);return send(res,200,{mode:'extractive_search_not_ai',answer:hits.length?'[팀 공유 파일의 관련 구절 · AI 아님]\n\n'+hits.map((x,i)=>`${i+1}. ${x.name}\n“${x.part}”`).join('\n\n'):'[팀 공유 파일 검색]\n일치하는 구절이 없습니다. TXT, MD, CSV 문서를 올려주세요.',sources:hits.map(x=>({project:'CES 2027',file:x.name}))});
  }catch{return send(res,400,{error:'Invalid question'})}
 }
 return send(res,404,{error:'Not found'});
});
const port=Number(process.env.PORT||4173);server.listen(port,'0.0.0.0',()=>console.log(`A-Dos alpha shared demo: http://localhost:${port}`));
