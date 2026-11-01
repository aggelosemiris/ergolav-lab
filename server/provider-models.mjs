const PREFERRED=['gemini-3.5-flash-lite','gemini-2.5-flash-lite','gemini-flash-lite-latest','gemini-flash-latest','gemini-2.5-flash','gemini-3.8-flash'];
export function selectGoogleModel(models){
 const available=new Set((models||[]).filter(m=>(m.supportedGenerationMethods||m.supportedActions||[]).includes('generateContent')).map(m=>String(m.name||'').replace(/^models\//,'')));
 const selected=PREFERRED.find(m=>available.has(m));if(!selected)throw new Error('Δεν βρέθηκε διαθέσιμο συμβατό μοντέλο Gemini Flash για το key σου.');return selected;
}
export async function resolveProviderModel(config,{signal,fetchImpl=fetch}={}){
 if(config.provider!=='gemini')return config;
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)throw new DOMException('Aborted','AbortError');signal?.addEventListener('abort',abort,{once:true});let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Η Google δεν επέστρεψε τα διαθέσιμα μοντέλα μέσα σε 15 δευτερόλεπτα.'))},15000)});
 try{return await Promise.race([(async()=>{const r=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{headers:{'x-goog-api-key':config.key},signal:controller.signal});if(!r.ok)throw new Error(`Google · HTTP ${r.status}: Δεν έγινε δεκτός ο έλεγχος πρόσβασης στα μοντέλα.`);const body=await r.json();return {...config,model:selectGoogleModel(body.models)}})(),timeout])}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
