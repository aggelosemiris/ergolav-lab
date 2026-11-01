import {materialSnapshot} from './installation.js';
import {serviceStatus,serviceAnalysis,completeJob,releaseJob} from './service-client.js';
import {makePdf,download} from './share.js';
const $=id=>document.getElementById(id);
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
export function mountInstallation(getQuote){
 let controller=null,report=null,file=null,generation=0,progressTimer=null,phaseLabel='',phaseStarted=0,pdfBusy=false;
 let serviceInfo=null;
 async function refreshService(){try{serviceInfo=await serviceStatus();$('installServiceInfo').textContent=serviceInfo.configured?`Υπηρεσία ενεργή · ${serviceInfo.available} διαθέσιμες δοκιμαστικές μονάδες. Το PDF χρησιμοποιεί 1 μονάδα μόνο όταν δημιουργηθεί επιτυχώς.`:'Η υπηρεσία χρειάζεται ενεργοποίηση από τον διαχειριστή.';generate.disabled=!serviceInfo.configured||serviceInfo.available<1}catch(e){$('installServiceInfo').textContent=e.message;generate.disabled=true}}
 function discard(){if(report?.jobId)releaseJob(report.jobId).catch(()=>{});report=null;file=null}
 const dialog=$('installDialog'),status=$('installStatus'),output=$('installReport'),generate=$('installGenerate'),save=$('installDownload'),review=$('installReviewed');
 function stopProgress(){clearInterval(progressTimer);progressTimer=null}
 function progress(text){phaseLabel=text;phaseStarted=Date.now();paintProgress()}
 function paintProgress(){const seconds=Math.floor((Date.now()-phaseStarted)/1000);status.textContent=phaseLabel+` · ${seconds} δευτ.`+(seconds>=20?`\nΠεριμένουμε απάντηση από την υπηρεσία ergolav. Μπορείς να πατήσεις Διακοπή.`:'')}
 function reset(){if(pdfBusy)return;discard();stopProgress();$('installCancel').hidden=true;generation++;controller?.abort();controller=null;report=null;file=null;output.replaceChildren();$('installPreview').hidden=true;review.checked=false;save.disabled=true;status.textContent='';generate.disabled=false;dialog.close()}
 $('installOpen').onclick=()=>{if(controller)return;dialog.showModal();refreshService()};
 $('installClose').onclick=reset;dialog.addEventListener('cancel',e=>{e.preventDefault();reset()});
 $('installCancel').onclick=()=>{controller?.abort()};
 review.onchange=()=>save.disabled=!review.checked||!report;
 function heading(parent,text,tag='h3'){parent.append(element(tag,text))}
 function bullet(parent,title,items,ordered=false){heading(parent,title,'h4');if(!items.length){parent.append(element('p','Δεν δηλώθηκαν επιπλέον στοιχεία.'));return}const list=element(ordered?'ol':'ul');for(const text of items)list.append(element('li',text));parent.append(list)}
 function renderReport(data,quote){
  output.replaceChildren();heading(output,'Ανάλυση εργασιών τοποθέτησης','h2');output.append(element('p',`Συνοδευτικό προσφοράς αρ. ${quote.number} · ${new Date(data.createdAt).toLocaleDateString('el-GR')}`));
  output.append(element('p','Προσχέδιο τεχνικής περιγραφής με AI. Χρειάζεται έλεγχο από τον αρμόδιο τεχνικό και τις οδηγίες του κατασκευαστή. Δεν αποτελεί μελέτη εφαρμογής ή αλλαγή της οικονομικής προσφοράς.','install-notice'));
  output.append(element('p',`Αξιολογήθηκαν ${data.items.length} υλικά · επιλέχθηκαν ${data.guides.length} για ανάλυση.`));
  for(const item of data.items){const d=data.decisions.find(x=>x.id===item.id);if(!d.selected)continue;const g=data.guides.find(x=>x.id===item.id);const section=element('section');heading(section,`${item.description} — ${item.quantity} ${item.unit}`);section.append(element('p','Γιατί αναλύεται: '+d.reason),element('p',g.scope));bullet(section,'Προϋποθέσεις / προεργασία',g.prerequisites);bullet(section,'Εργαλεία και εξοπλισμός',g.tools);bullet(section,'Στάδια τοποθέτησης',g.steps,true);bullet(section,'Έλεγχοι και παράδοση',g.checks);bullet(section,'Στοιχεία που πρέπει να επιβεβαιωθούν',g.missing);section.append(element('p','Αρμόδιος τεχνικός: '+(g.specialist||'Κατάλληλος επαγγελματίας για το είδος της εγκατάστασης.')));output.append(section)}
  heading(output,'Υλικά χωρίς ξεχωριστή ανάλυση');const skipped=data.items.filter(x=>!data.decisions.find(d=>d.id===x.id).selected);if(!skipped.length)output.append(element('p','Αναλύθηκαν όλα τα υλικά.'));for(const item of skipped)output.append(element('p',item.description+' — '+data.decisions.find(x=>x.id===item.id).reason));
  output.append(element('p',`Δημιουργία: ${data.provider==='openai'?'OpenAI':'Gemini'} (${data.model}). Οι τιμές και τα σύνολα της προσφοράς παραμένουν ανεξάρτητα από αυτό το έγγραφο.`,'install-notice'));
 }
 generate.onclick=async()=>{
  if(controller||pdfBusy)return;const run=++generation;controller=new AbortController();generate.disabled=true;save.disabled=true;discard();review.checked=false;$('installPreview').hidden=true;$('installCancel').hidden=false;progress('Σύνδεση με την υπηρεσία ergolav…');progressTimer=setInterval(paintProgress,1000);
  try{const quote=getQuote(),items=materialSnapshot(quote.lines);
   const data=await serviceAnalysis(items,{signal:controller.signal,onProgress:text=>{if(run===generation)progress(text)}});
   if(run!==generation)return;stopProgress();report=data;renderReport(data,quote);$('installPreview').hidden=false;status.textContent=data.guides.length?`Έτοιμη η ανάλυση ${data.guides.length} υλικών. Διάβασέ την πριν κατεβάσεις το PDF.`:'Δεν επιλέχθηκαν υλικά για περαιτέρω ανάλυση. Δες τις αιτιολογήσεις.';
  }catch(e){if(run===generation)stopProgress();if(run===generation)status.textContent=e.name==='AbortError'?'Η ανάλυση ακυρώθηκε. Η προσφορά σου παραμένει διαθέσιμη.':e.message||'Η ανάλυση απέτυχε. Δοκίμασε ξανά.'}
  finally{if(run===generation){stopProgress();controller=null;generate.disabled=false;$('installCancel').hidden=true}}
 };
 save.onclick=async()=>{if(!report||!review.checked||pdfBusy)return;const run=generation;pdfBusy=true;$('installClose').disabled=true;generate.disabled=true;save.disabled=true;try{status.textContent='Ετοιμάζω το ξεχωριστό PDF…';file??=await makePdf(output,`Analysi-Ergasion-${getQuote().number}.pdf`);if(run!==generation)return;const balance=await completeJob(report.jobId);$('installServiceInfo').textContent=`Απομένουν ${balance.balance} δοκιμαστικές μονάδες.`;download(file);status.textContent='Το PDF ανάλυσης εργασιών κατέβηκε.'}catch(e){status.textContent=e.message||'Το PDF δεν δημιουργήθηκε. Δοκίμασε ξανά.'}finally{pdfBusy=false;$('installClose').disabled=false;generate.disabled=false;if(run===generation)save.disabled=!review.checked||!report}};

 return {reset};
}
