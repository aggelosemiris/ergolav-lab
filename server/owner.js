const $=id=>document.getElementById(id);const show=s=>$('balance').textContent=`Υπηρεσία: ${s.configured?'ενεργή':'δεν έχει ενεργοποιηθεί'} · Δοκιμαστικές μονάδες: ${s.balance} (${s.available} διαθέσιμες)`;
async function post(url,p){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}),data=await r.json();if(!r.ok)throw new Error(data.error);return data}
fetch('/api/service/status').then(r=>r.json()).then(show).catch(()=>$('status').textContent='Ο τοπικός server δεν απαντά.');
$('setup').onsubmit=async e=>{e.preventDefault();$('check').disabled=true;$('status').textContent='Πραγματικός έλεγχος σύνδεσης…';try{const data=await post('/api/admin/configure',{provider:$('provider').value,apiKey:$('key').value});$('key').value='';show(data);$('status').textContent=data.message}catch(e){$('status').textContent=e.message}finally{$('check').disabled=false}};
$('provider').onchange=()=>{$('key').value='';$('status').textContent=''};
$('reset').onclick=async()=>{try{show(await post('/api/admin/reset-demo',{}));$('status').textContent='Διαθέσιμες 5 δοκιμαστικές μονάδες.'}catch(e){$('status').textContent=e.message}};
