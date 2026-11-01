export async function serviceStatus(){const r=await fetch('/api/service/status',{cache:'no-store'});if(!r.ok)throw new Error('Ο server της υπηρεσίας δεν είναι διαθέσιμος.');return r.json()}
export async function serviceAnalysis(items,{signal,onProgress=()=>{},setup}={}){
 try{
  const r=await fetch('/api/service/analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,...(setup?{setup}:{})}),signal});
  if(!r.ok){const e=await r.json();throw new Error(e.error||'Η υπηρεσία δεν είναι διαθέσιμη.')}
  if(!r.body)throw new Error('Ο browser δεν υποστηρίζει τη ροή της ανάλυσης.');
  const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',result;
  function event(line){if(!line.trim())return;const e=JSON.parse(line);if(e.type==='progress')onProgress(e.message);if(e.type==='error')throw new Error(e.message);if(e.type==='result')result={...e.report,jobId:e.jobId}}
  try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+1)}if(buffer.length>2000000)throw new Error('Η αναφορά είναι πολύ μεγάλη.')}buffer+=decoder.decode();event(buffer)}finally{reader.releaseLock()}
  if(!result)throw new Error('Η σύνδεση διακόπηκε πριν παραδοθεί η ανάλυση. Δεν αφαιρέθηκε μονάδα.');return result;
 }catch(e){if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(e.name==='AbortError'||e instanceof TypeError)throw new Error('Η σύνδεση με τον server διακόπηκε. Δεν πρόκειται απαραίτητα για λάθος key. Δοκίμασε ξανά.');throw e}
}
async function action(url,jobId){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId}),keepalive:true});const data=await r.json();if(!r.ok)throw new Error(data.error);return data}
export const completeJob=jobId=>action('/api/service/complete',jobId);
export const releaseJob=jobId=>action('/api/service/release',jobId);
