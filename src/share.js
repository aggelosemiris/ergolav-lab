// Πραγματική αποστολή: PDF από την προεπισκόπηση → μενού κοινοποίησης του κινητού (Viber, WhatsApp, email…).

let libPromise = null;
function loadPdfLib(){
  if(window.html2pdf) return Promise.resolve(window.html2pdf);
  libPromise ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/html2pdf.bundle.min.js';
    s.onload = () => ok(window.html2pdf);
    s.onerror = () => { libPromise = null; fail(new Error('Δεν φόρτωσε το εργαλείο PDF. Έλεγξε τη σύνδεση.')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

/** Φτιάχνει A4 PDF από το στοιχείο της προεπισκόπησης. */
export async function makePdf(el, filename){
  const html2pdf = await loadPdfLib();
  const blob = await html2pdf().set({
    margin: [10, 10, 12, 10],
    image: {type: 'jpeg', quality: 0.95},
    html2canvas: {scale: 2, backgroundColor: '#ffffff'},
    jsPDF: {unit: 'mm', format: 'a4', orientation: 'portrait'},
    pagebreak: {mode: ['css', 'legacy']},
  }).from(el).outputPdf('blob');
  return new File([blob], filename, {type: 'application/pdf'});
}

export const canShareFiles = files => Array.isArray(files)&&files.length>0&&files.every(Boolean)&&!!navigator.canShare?.({files});
export const canShareFile = file => canShareFiles([file]);

/** Share already-prepared files immediately within the click gesture. */
export async function shareFiles(files,{title,text}){
 if(!canShareFiles(files))return 'unsupported';
 try{await navigator.share({files,title,text});return 'shared'}
 catch(e){return e.name==='AbortError'?'cancelled':'unsupported'}
}
export const shareFile = (file,meta) => shareFiles([file],meta);

export function download(file){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
