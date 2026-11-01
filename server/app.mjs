import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {analyzeMaterials,materialSnapshot,normalizeGeminiKey,requestGemini,MODEL,OPENAI_MODEL} from '../src/installation.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createService({root=repo,stateFile=path.join(repo,'.service-data','lab.json'),fetchImpl=fetch,analyze=analyzeMaterials,probe=requestGemini}={}){
 let config=null,configuring=false;const jobs=new Map();let ledger={balance:5,completed:[]};
 if(stateFile&&fs.existsSync(stateFile)){try{ledger=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(!Number.isInteger(ledger.balance)||ledger.balance<0||!Array.isArray(ledger.completed))throw Error()}catch{throw new Error('Μη έγκυρο αρχείο δοκιμαστικών μονάδων.')}}
 const persist=()=>{if(!stateFile)return;fs.mkdirSync(path.dirname(stateFile),{recursive:true});const temporary=stateFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify(ledger),{mode:0o600});fs.renameSync(temporary,stateFile)};
 const expire=()=>{for(const [id,j] of jobs)if(j.expires<Date.now()&&j.status!=='running')jobs.delete(id)};
 const status=()=>{expire();return {configured:!!config,provider:config?.provider||'openai',model:config?.model||OPENAI_MODEL,balance:ledger.balance,available:Math.max(0,ledger.balance-jobs.size),demo:true}};
 function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
 async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>100000)throw new Error('Το αίτημα είναι πολύ μεγάλο.')}try{return JSON.parse(text)}catch{throw new Error('Μη έγκυρο αίτημα.')}}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const origin=`http://${req.headers.host}`,host=(req.headers.host||'').split(':')[0];
  if(!['127.0.0.1','localhost'].includes(host))return json(res,403,{error:'Η δοκιμαστική υπηρεσία λειτουργεί μόνο τοπικά.'});
  const url=new URL(req.url,origin),route=url.pathname;
  if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/json'))return json(res,403,{error:'Μη επιτρεπτή προέλευση αιτήματος.'});
  try{
   if(req.method==='GET'&&route==='/api/service/status')return json(res,200,status());
   if(req.method==='POST'&&route==='/api/admin/configure'){
    if(configuring||jobs.size)return json(res,409,{error:'Περίμενε να ολοκληρωθεί η τρέχουσα εργασία.'});configuring=true;
    try{
     const p=await body(req);if(!['openai','gemini'].includes(p.provider))throw new Error('Επίλεξε υπηρεσία.');const key=normalizeGeminiKey(p.apiKey,p.provider),model=p.provider==='openai'?OPENAI_MODEL:MODEL;
     const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()});
     const check=await probe(key,'Έλεγχος σύνδεσης. Επίστρεψε μόνο JSON με ok true.',{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},controller.signal,fetchImpl,{provider:p.provider,model,classification:true,timeoutMs:30000});
     if(check?.ok!==true)throw new Error('Η υπηρεσία δεν επιβεβαίωσε τη δοκιμή σύνδεσης.');config={provider:p.provider,key,model};return json(res,200,{...status(),message:'Η πραγματική δοκιμή API ολοκληρώθηκε επιτυχώς. Η υπηρεσία ενεργοποιήθηκε.'});
    }finally{configuring=false}
   }
   if(req.method==='POST'&&route==='/api/service/analysis'){
    const p=await body(req);let initial=null;
    if(!config&&p.setup){if(!['openai','gemini'].includes(p.setup.provider))throw new Error('Επίλεξε υπηρεσία.');initial={provider:p.setup.provider,key:normalizeGeminiKey(p.setup.apiKey,p.setup.provider),model:p.setup.provider==='openai'?OPENAI_MODEL:MODEL}}
    if(!config&&!initial)return json(res,503,{error:'Για την πρώτη δοκιμή, συμπλήρωσε το key διαχειριστή μέσα στην έτοιμη προσφορά.'});
    if(configuring)return json(res,409,{error:'Η υπηρεσία ρυθμίζεται. Δοκίμασε ξανά σε λίγο.'});
    if(status().available<1)return json(res,402,{error:'Δεν υπάρχουν διαθέσιμες δοκιμαστικές μονάδες.'});
    if([...jobs.values()].some(j=>j.status==='running'))return json(res,409,{error:'Υπάρχει ήδη ανάλυση σε εξέλιξη. Περίμενε ή πάτησε Διακοπή.'});
    const items=materialSnapshot((p.items||[]).map(x=>({desc:x.description,qty:x.quantity,unit:x.unit}))),id=crypto.randomUUID(),controller=new AbortController();
    const j={status:'running',expires:Date.now()+1800000};jobs.set(id,j);const current=config||initial;
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    const send=event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n')};res.on('close',()=>{if(!res.writableEnded){controller.abort();jobs.delete(id)}});
    const heartbeat=setInterval(()=>send({type:'heartbeat'}),5000);
    try{
     const report=await analyze(items,{provider:current.provider,model:current.model,apiKey:current.key,fetchImpl,signal:controller.signal,onProgress:message=>send({type:'progress',message})});
     if(controller.signal.aborted)return;if(!config)config=current;j.status='ready';j.report=report;j.expires=Date.now()+1800000;send({type:'result',report,jobId:id});
    }catch(e){jobs.delete(id);if(!controller.signal.aborted)send({type:'error',message:e.name==='AbortError'?'Η σύνδεση της υπηρεσίας διακόπηκε. Δεν αφαιρέθηκε μονάδα.':e.message})}
    finally{clearInterval(heartbeat);res.end()}return;
   }
   if(req.method==='POST'&&route==='/api/service/complete'){
    const p=await body(req);if(ledger.completed.includes(p.jobId))return json(res,200,status());const j=jobs.get(p.jobId);if(!j||j.status!=='ready')return json(res,409,{error:'Η ανάλυση έληξε ή δεν ολοκληρώθηκε. Δημιούργησέ την ξανά.'});
    const next={balance:ledger.balance-1,completed:[...ledger.completed,p.jobId]};if(next.balance<0)throw new Error('Δεν υπάρχει διαθέσιμη μονάδα.');const old=ledger;ledger=next;try{persist()}catch(e){ledger=old;throw new Error('Δεν αποθηκεύτηκε η χρήση. Δοκίμασε ξανά.')}jobs.delete(p.jobId);return json(res,200,status());
   }
   if(req.method==='POST'&&route==='/api/service/release'){const p=await body(req),j=jobs.get(p.jobId);if(j?.status==='ready')jobs.delete(p.jobId);return json(res,200,status())}
   if(req.method==='POST'&&route==='/api/admin/reset-demo'){if(jobs.size)return json(res,409,{error:'Ολοκλήρωσε ή κλείσε πρώτα τις αναλύσεις.'});ledger={balance:5,completed:[]};persist();return json(res,200,status())}
   if(req.method!=='GET'&&req.method!=='HEAD')return json(res,404,{error:'Δεν βρέθηκε.'});
   if(route==='/owner.html')return serve(path.join(repo,'server','owner.html'),'text/html; charset=utf-8');
   if(route==='/owner.js')return serve(path.join(repo,'server','owner.js'),'text/javascript; charset=utf-8');
   const decoded=decodeURIComponent(route),relative=decoded==='/'?'index.html':decoded.slice(1);
   if(relative.split('/').some(part=>part.startsWith('.')))return json(res,404,{error:'Δεν βρέθηκε.'});
   if(!['index.html','favicon.ico'].includes(relative)&&!/^((src|vendor|media)\/[a-zA-Z0-9_.\/-]+)$/.test(relative))return json(res,404,{error:'Δεν βρέθηκε.'});
   const file=path.resolve(root,relative);if(!file.startsWith(path.resolve(root)+path.sep))return json(res,403,{error:'Μη επιτρεπτό αρχείο.'});
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';return serve(file,type);
   function serve(file,type){if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Δεν βρέθηκε.'});res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res)}
  }catch(e){if(!res.headersSent)json(res,400,{error:e.message||'Η υπηρεσία δεν ολοκλήρωσε το αίτημα.'});else res.end()}
 });
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
 createService({root:path.resolve(value('--root',repo))}).listen(Number(value('--port','8087')),'127.0.0.1',()=>console.log('ergolav δοκιμών: http://127.0.0.1:'+value('--port','8087')+'/ · Διαχείριση: /owner.html'));
}
