import {materialSnapshot} from './installation.js';
import {serviceStatus,serviceAnalysis,completeJob,releaseJob} from './service-client.js';
import {makePdf,download} from './share.js';
import {fitImage} from './image.js';
// Φωτογραφίες εργασίας στο συνοδευτικό PDF: μόνο τοπικά (δεν στέλνονται στην υπηρεσία AI), έως MAX_PHOTOS.
export const MAX_PHOTOS=12;
const $=id=>document.getElementById(id);
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
export function mountInstallation(getQuote,{onReady=()=>{},onDiscard=()=>{},onShare=()=>{}}={}){
 let controller=null,report=null,file=null,generation=0,progressTimer=null,phaseLabel='',phaseStarted=0,pdfBusy=false;
 let serviceInfo=null,photos=[];
 async function refreshService(){try{serviceInfo=await serviceStatus();$('installServiceInfo').textContent=serviceInfo.configured?`Υπηρεσία ενεργή · ${serviceInfo.available} διαθέσιμες δοκιμαστικές μονάδες. Το PDF χρησιμοποιεί 1 μονάδα μόνο όταν δημιουργηθεί επιτυχώς.`:'Η υπηρεσία θα ενεργοποιηθεί με την ανάλυση αυτής της προσφοράς.';$('installInitialSetup').hidden=serviceInfo.configured;generate.disabled=serviceInfo.available<1}catch(e){$('installServiceInfo').textContent=e.message;generate.disabled=true}}
 function discard(){if(report?.jobId)releaseJob(report.jobId).catch(()=>{});report=null;file=null}
 const dialog=$('installDialog'),status=$('installStatus'),output=$('installReport'),generate=$('installGenerate'),save=$('installDownload'),review=$('installReviewed'),prepare=$('installPrepareBoth'),share=$('installShareBoth');
 function stopProgress(){clearInterval(progressTimer);progressTimer=null}
 function progress(text){phaseLabel=text;phaseStarted=Date.now();paintProgress()}
 function paintProgress(){const seconds=Math.floor((Date.now()-phaseStarted)/1000);status.textContent=phaseLabel+` · ${seconds} δευτ.`+(seconds>=20?`\nΠεριμένουμε απάντηση από την υπηρεσία ergolav. Μπορείς να πατήσεις Διακοπή.`:'')}
 function reset(){if(pdfBusy)return;photos=[];renderPhotos();$('installPhotoStatus').textContent='';$('installSetupProvider').disabled=false;$('installSetupKey').disabled=false;discard();stopProgress();$('installCancel').hidden=true;generation++;controller?.abort();controller=null;report=null;file=null;output.replaceChildren();$('installPreview').hidden=true;review.checked=false;save.disabled=true;prepare.disabled=true;prepare.hidden=false;share.hidden=true;status.textContent='';generate.disabled=false;$('installSetupKey').value='';dialog.close()}
 $('installOpen').onclick=()=>{if(controller)return;dialog.showModal();const quote=getQuote(),items=materialSnapshot(quote.lines);$('installQuoteSummary').textContent=`Προσφορά αρ. ${quote.number} · ${items.length} υλικά`;$('installQuoteMaterials').replaceChildren(...items.map(x=>element('li',`${x.description} — ${x.quantity} ${x.unit}`)));refreshService()};
 $('installClose').onclick=reset;dialog.addEventListener('cancel',e=>{e.preventDefault();reset()});
 $('installCancel').onclick=()=>{controller?.abort()};
 // Αλλαγή φωτογραφιών αφού ετοιμάστηκε το PDF: το PDF ξαναφτιάχνεται (η ολοκλήρωση στον server είναι idempotent — καμία δεύτερη χρέωση).
 function photosChanged(){if(file){file=null;onDiscard();share.hidden=true;prepare.hidden=false;status.textContent='Άλλαξαν οι φωτογραφίες· πάτησε ξανά «Ετοίμασε και τα δύο PDF».'}renderPhotos();updateActions()}
 function renderPhotos(){
  $('installPhotoList').replaceChildren(...photos.map((ph,i)=>{const row=element('div',undefined,'photo-item'),img=element('img');img.src=ph.url;img.alt=`Φωτογραφία ${i+1}`;const body=element('div',undefined,'ph-body'),cap=element('input');cap.placeholder='Λεζάντα (προαιρετικό), π.χ. «Πριν την αποξήλωση»';cap.maxLength=120;cap.value=ph.caption;cap.setAttribute('aria-label',`Λεζάντα φωτογραφίας ${i+1}`);cap.oninput=()=>{ph.caption=cap.value;const fc=output.querySelectorAll('.report-photos figcaption')[i];if(fc){fc.textContent=cap.value.trim();fc.hidden=!cap.value.trim()}if(file){file=null;onDiscard();share.hidden=true;prepare.hidden=false;updateActions()}};const rm=element('button','Αφαίρεση','linkbtn');rm.type='button';rm.onclick=()=>{if(pdfBusy)return;photos.splice(i,1);photosChanged()};body.append(cap,rm);row.append(img,body);return row}));
  $('installPhotoAdd').disabled=photos.length>=MAX_PHOTOS||pdfBusy;$('installPhotoAdd').textContent=photos.length?`📷 Πρόσθεσε κι άλλες (${photos.length}/${MAX_PHOTOS})`:'📷 Πρόσθεσε φωτογραφίες';
  // Στο PDF: ενότητα στο τέλος της ανάλυσης, με τη σειρά και τις λεζάντες που έδωσε ο τεχνίτης.
  output.querySelector('.report-photos')?.remove();
  if(photos.length&&report){const sec=element('section',undefined,'report-photos');heading(sec,'Φωτογραφίες εργασίας');for(const ph of photos){const fig=element('figure'),img=element('img'),fc=element('figcaption',ph.caption.trim());img.src=ph.url;img.alt=ph.caption.trim()||'Φωτογραφία εργασίας';fc.hidden=!ph.caption.trim();fig.append(img,fc);sec.append(fig)}const last=output.querySelector('.install-notice:last-child');last?output.insertBefore(sec,last):output.append(sec)}
 }
 $('installPhotoAdd').onclick=()=>$('installPhotoInput').click();
 $('installPhotoInput').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length||pdfBusy)return;
  const room=MAX_PHOTOS-photos.length,take=files.slice(0,room);let bad=0;
  for(const f of take){try{photos.push({url:(await fitImage(f,{max:1280,type:'image/jpeg',quality:0.8})).url,caption:''})}catch{bad++}}
  $('installPhotoStatus').textContent=[files.length>room?`Έως ${MAX_PHOTOS} φωτογραφίες — δεν μπήκαν ${files.length-room}.`:'',bad?`${bad} αρχεία δεν ήταν εικόνες που ανοίγουν.`:''].filter(Boolean).join(' ');
  photosChanged();
 };
 function updateActions(){save.disabled=prepare.disabled=!review.checked||!report||pdfBusy;share.disabled=!review.checked||!file||pdfBusy;$('installPhotoAdd').disabled=photos.length>=MAX_PHOTOS||pdfBusy} review.onchange=updateActions;
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
  if(controller||pdfBusy)return;const run=++generation;controller=new AbortController();generate.disabled=true;save.disabled=true;prepare.disabled=true;prepare.hidden=false;share.hidden=true;onDiscard();discard();review.checked=false;$('installPreview').hidden=true;$('installCancel').hidden=false;progress('Σύνδεση με την υπηρεσία ergolav…');progressTimer=setInterval(paintProgress,1000);$('installSetupProvider').disabled=true;$('installSetupKey').disabled=true;
  try{const quote=getQuote(),items=materialSnapshot(quote.lines),setup=serviceInfo?.configured?undefined:{provider:$('installSetupProvider').value,apiKey:$('installSetupKey').value};
   const data=await serviceAnalysis(items,{setup,signal:controller.signal,onProgress:text=>{if(run===generation)progress(text)}});
   if(run!==generation)return;stopProgress();$('installSetupKey').value='';$('installInitialSetup').hidden=true;serviceInfo={...serviceInfo,configured:true};$('installServiceInfo').textContent='Η υπηρεσία είναι ενεργή. Η ανάλυση αφορά τα υλικά αυτής της προσφοράς.';report=data;renderReport(data,quote);renderPhotos();$('installPreview').hidden=false;status.textContent=data.guides.length?`Έτοιμη η ανάλυση ${data.guides.length} υλικών. Διάβασέ την πριν κατεβάσεις το PDF.`:'Δεν επιλέχθηκαν υλικά για περαιτέρω ανάλυση. Δες τις αιτιολογήσεις.';
  }catch(e){if(run===generation)stopProgress();if(run===generation)status.textContent=e.name==='AbortError'?'Η ανάλυση ακυρώθηκε. Η προσφορά σου παραμένει διαθέσιμη.':e.message||'Η ανάλυση απέτυχε. Δοκίμασε ξανά.'}
  finally{if(run===generation){stopProgress();controller=null;$('installSetupProvider').disabled=false;$('installSetupKey').disabled=false;generate.disabled=false;$('installCancel').hidden=true}}
 };
 async function prepareFile(){
  if(!report||!review.checked||pdfBusy)return null;const run=generation;pdfBusy=true;$('installClose').disabled=true;generate.disabled=true;updateActions();
  try{status.textContent='Ετοιμάζω το συνοδευτικό PDF…';file??=await makePdf(output,`Analysi-Ergasion-${getQuote().number}.pdf`);if(run!==generation)return null;const balance=await completeJob(report.jobId);$('installServiceInfo').textContent=`Απομένουν ${balance.balance} δοκιμαστικές μονάδες.`;onReady(file);share.hidden=false;prepare.hidden=true;status.textContent='Έτοιμα και τα δύο PDF. Πάτησε «Στείλε και τα δύο PDF» για να τα μοιραστείς μαζί.';return file}
  catch(e){status.textContent=e.message||'Το PDF δεν δημιουργήθηκε. Δοκίμασε ξανά.';return null}
  finally{pdfBusy=false;$('installClose').disabled=false;generate.disabled=false;updateActions()}
 }
 prepare.onclick=prepareFile;
 save.onclick=async()=>{const ready=await prepareFile();if(ready){download(ready);status.textContent='Η ανάλυση κατέβηκε. Μπορείς επίσης να στείλεις και τα δύο PDF μαζί.'}};
 share.onclick=()=>{if(!file||!review.checked||pdfBusy)return;reset();onShare()};

 $('installSetupProvider').onchange=()=>{$('installSetupKey').value='';status.textContent=''};
 return {reset};
}
