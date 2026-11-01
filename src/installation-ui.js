import {analyzeMaterials,materialSnapshot} from './installation.js';
import {makePdf,download} from './share.js';
const $=id=>document.getElementById(id);
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
export function mountInstallation(getQuote){
 let controller=null,report=null,file=null,generation=0;
 const dialog=$('installDialog'),status=$('installStatus'),output=$('installReport'),generate=$('installGenerate'),save=$('installDownload'),review=$('installReviewed');
 function reset(){generation++;controller?.abort();controller=null;report=null;file=null;output.replaceChildren();$('installPreview').hidden=true;review.checked=false;save.disabled=true;status.textContent='';generate.disabled=false;$('installKey').value='';dialog.close()}
 $('installOpen').onclick=()=>{if(controller)return;dialog.showModal();$('installKey').focus()};
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
  output.append(element('p',`Δημιουργία: Gemini (${data.model}). Οι τιμές και τα σύνολα της προσφοράς παραμένουν ανεξάρτητα από αυτό το έγγραφο.`,'install-notice'));
 }
 generate.onclick=async()=>{
  if(controller)return;const run=++generation;controller=new AbortController();generate.disabled=true;save.disabled=true;report=null;file=null;review.checked=false;$('installPreview').hidden=true;$('installCancel').hidden=false;
  try{const quote=getQuote(),items=materialSnapshot(quote.lines),key=$('installKey').value.trim();
   const data=await analyzeMaterials(items,{apiKey:key,signal:controller.signal,onProgress:text=>{if(run===generation)status.textContent=text}});
   if(run!==generation)return;report=data;renderReport(data,quote);$('installPreview').hidden=false;status.textContent=data.guides.length?`Έτοιμη η ανάλυση ${data.guides.length} υλικών. Διάβασέ την πριν κατεβάσεις το PDF.`:'Δεν επιλέχθηκαν υλικά για περαιτέρω ανάλυση. Δες τις αιτιολογήσεις.';
  }catch(e){if(run===generation)status.textContent=e.name==='AbortError'?'Η ανάλυση ακυρώθηκε. Η προσφορά σου παραμένει διαθέσιμη.':e.message||'Η ανάλυση απέτυχε. Δοκίμασε ξανά.'}
  finally{if(run===generation){controller=null;generate.disabled=false;$('installCancel').hidden=true}}
 };
 save.onclick=async()=>{if(!report||!review.checked)return;const run=generation;save.disabled=true;try{status.textContent='Ετοιμάζω το ξεχωριστό PDF…';file??=await makePdf(output,`Analysi-Ergasion-${getQuote().number}.pdf`);if(run!==generation)return;download(file);status.textContent='Το PDF ανάλυσης εργασιών κατέβηκε.'}catch(e){status.textContent=e.message||'Το PDF δεν δημιουργήθηκε. Δοκίμασε ξανά.'}finally{if(run===generation)save.disabled=!review.checked||!report}};
 return {reset};
}
