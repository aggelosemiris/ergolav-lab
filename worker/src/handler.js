// Η λογική της υπηρεσίας «Άλλαξέ το» (POST /rewrite-section), χωρίς εξαρτήσεις από το Cloudflare ή το SDK, ώστε να
// ελέγχεται με τεστ στο Node. Ο worker (index.js) δίνει: env (ρυθμίσεις), createMessage (κλήση στο Claude API) και
// limit (όριο αιτημάτων ανά συσκευή, IP και συνολικά).
// Logs: μία γραμμή ανά αίτημα με μετρήσεις (κατάσταση, χρόνος, tokens). Ποτέ το κείμενο αιτήματος ή απάντησης.
import { validateAnalysis } from '../../src/analysis-schema.js';
import { QUICK, LIMITS, applyRewrite, stripPersonal } from '../../src/rewrite-client.js';
import { buildRequest, readItems } from './prompt.js';

export const MAX_BODY = 32 * 1024;
export const TIMEOUT_MS = 25000;
const DEVICE = /^[0-9a-f-]{36}$/;

export const ERRORS = {
  origin: 'Η υπηρεσία δέχεται αιτήματα μόνο από την εφαρμογή ergolav.',
  notFound: 'Δεν βρέθηκε.',
  method: 'Η υπηρεσία δέχεται μόνο αιτήματα POST.',
  device: 'Λείπει το αναγνωριστικό της συσκευής. Ανανέωσε τη σελίδα και δοκίμασε ξανά.',
  big: 'Το κείμενο είναι πολύ μεγάλο. Γράψε πιο σύντομα τι θέλεις.',
  invalid: 'Το αίτημα δεν είναι σωστό. Ανανέωσε τη σελίδα και δοκίμασε ξανά.',
  empty: 'Πες ή γράψε τι θέλεις να αλλάξει.',
  busy: minutes => `Έκανες πολλές αλλαγές σε λίγη ώρα. Δοκίμασε ξανά σε ${minutes} ${minutes === 1 ? 'λεπτό' : 'λεπτά'}.`,
  busyAll: 'Η υπηρεσία έχει πολλά αιτήματα αυτή τη στιγμή. Δοκίμασε ξανά αργότερα.',
  timeout: 'Η απάντηση άργησε πολύ. Δοκίμασε ξανά σε λίγο.',
  refusal: 'Το AI δεν έγραψε νέα εκδοχή για αυτό το κείμενο. Ζήτησέ το με άλλα λόγια.',
  bad: 'Η νέα εκδοχή δεν πέρασε τον έλεγχο. Δοκίμασε ξανά.',
  upstream: 'Η υπηρεσία AI δεν απάντησε. Δοκίμασε ξανά σε λίγο.',
  config: 'Η υπηρεσία δεν έχει ρυθμιστεί ακόμα.',
};

/** Έλεγχος του αιτήματος: {payload} ή {error, status}. Ό,τι στέλνεται στο AI βγαίνει από εδώ. */
export function checkPayload(p){
  const bad = (error = ERRORS.invalid, status = 400) => ({error, status});
  if(!p || typeof p !== 'object' || Array.isArray(p)) return bad();
  const a = p.analysis;
  if(!a || typeof a !== 'object' || !Array.isArray(a.sections)) return bad();
  // Η ανάλυση πρέπει να περνά τους κανόνες της Φάσης 4 (αυτό φράζει και το μέγεθός της).
  const analysis = {id: a.id, title: a.title, trade: a.trade, typical_duration: a.typical_duration,
    requires_licensed_professional: a.requires_licensed_professional, related_consumables: [], notes_for_master: '',
    sections: a.sections.map(s => ({key: s?.key, title: s?.title, items: Array.isArray(s?.items) ? s.items.map(i => ({id: i?.id, text: i?.text})) : s?.items}))};
  if(validateAnalysis(analysis).length) return bad();
  const t = p.target || {};
  const sec = analysis.sections.find(s => s.key === t.section);
  if(!sec || !['item', 'section'].includes(t.scope)) return bad();
  const focus = t.item_id == null ? null : sec.items.find(i => i.id === t.item_id);
  if((t.item_id != null && !focus) || (t.scope === 'item' && !focus)) return bad();
  const text = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
  const list = (v, n, max) => v == null || (Array.isArray(v) && v.length <= n && v.every(x => typeof x === 'string' && x.length <= max));
  if(!text(p.dislike, LIMITS.answer) || !text(p.want, LIMITS.answer) || !list(p.style_rules, LIMITS.rules, LIMITS.rule)) return bad(ERRORS.big, 413);
  if(!list(p.quick, QUICK.length, 40) || !(p.quick || []).every(q => QUICK.includes(q)) || !list(p.previous, 8, 320)) return bad();
  // Δεύτερο πέρασμα στα κείμενα του τεχνίτη: τηλέφωνα, email και «κ./κυρία Όνομα» (τα ονόματα του πελάτη τα βγάζει ήδη η εφαρμογή).
  const clean = s => stripPersonal(String(s ?? '')).trim();
  const payload = {analysis, target: {scope: t.scope, section: t.section, item_id: focus?.id ?? null},
    dislike: clean(p.dislike), want: clean(p.want), quick: QUICK.filter(q => (p.quick || []).includes(q)),
    style_rules: (p.style_rules || []).map(clean).filter(Boolean), previous: (p.previous || []).map(String)};
  if(!payload.dislike && !payload.want && !payload.quick.length) return bad(ERRORS.empty);
  return {payload};
}

export async function handle(request, {env = {}, createMessage, limit, log = line => console.log(line), now = Date.now}){
  const t0 = now(), stats = {};
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const cors = allowed.includes(origin) ? {'Access-Control-Allow-Origin': origin, Vary: 'Origin'} : {Vary: 'Origin'};
  const reply = (status, body, headers = {}) => {
    log(JSON.stringify({event: 'rewrite-section', status, ms: now() - t0, ...stats}));
    return new Response(body == null ? null : JSON.stringify(body), {status,
      headers: {...(body == null ? {} : {'Content-Type': 'application/json; charset=utf-8'}), 'Cache-Control': 'no-store', ...cors, ...headers}});
  };

  if(new URL(request.url).pathname !== '/rewrite-section') return reply(404, {error: ERRORS.notFound});
  // CORS: μόνο από το domain της εφαρμογής (ALLOWED_ORIGIN).
  if(!allowed.includes(origin)) return reply(403, {error: ERRORS.origin});
  if(request.method === 'OPTIONS') return reply(204, null, {'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id', 'Access-Control-Max-Age': '86400'});
  if(request.method !== 'POST') return reply(405, {error: ERRORS.method}, {Allow: 'POST, OPTIONS'});
  if(!env.ANTHROPIC_API_KEY) return reply(503, {error: ERRORS.config});

  const device = request.headers.get('X-Device-Id') || '';
  if(!DEVICE.test(device)) return reply(400, {error: ERRORS.device});
  // Όριο μεγέθους: πριν διαβαστεί το σώμα (Content-Length) και μετά (πραγματικό μέγεθος).
  if(Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return reply(413, {error: ERRORS.big});
  const raw = await request.text();
  if(new TextEncoder().encode(raw).length > MAX_BODY) return reply(413, {error: ERRORS.big});
  let body;
  try { body = JSON.parse(raw); } catch { return reply(400, {error: ERRORS.invalid}); }   // όχι log του σφάλματος: περιέχει κομμάτι του κειμένου
  const checked = checkPayload(body);
  if(checked.error) return reply(checked.status, {error: checked.error});
  const {payload} = checked;
  stats.scope = payload.target.scope;

  const allowedNow = await limit({device, ip: request.headers.get('CF-Connecting-IP') || ''});
  if(!allowedNow.ok){
    stats.limit = allowedNow.scope;
    const minutes = Math.max(1, Math.ceil(allowedNow.retryAfter / 60));
    return reply(429, {error: allowedNow.scope === 'global' ? ERRORS.busyAll : ERRORS.busy(minutes)}, {'Retry-After': String(allowedNow.retryAfter)});
  }

  // Κλήση στο AI με χρονικό όριο· μία ακόμα προσπάθεια αν η απάντηση δεν περάσει τον έλεγχο και υπάρχει χρόνος.
  let errors = [];
  const timeout = Number(env.TIMEOUT_MS) || TIMEOUT_MS;
  stats.attempts = 0; stats.input_tokens = 0; stats.output_tokens = 0; stats.cache_read = 0;
  while(stats.attempts < 2){
    stats.attempts++;
    const left = timeout - (now() - t0);
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), left);
    let message;
    try {
      message = await createMessage(buildRequest(payload, env, errors), {signal: ctrl.signal, timeout: left});
    } catch(e){
      stats.error = e?.status || e?.name || 'error';
      return ctrl.signal.aborted || /timeout/i.test(e?.name || '') ? reply(504, {error: ERRORS.timeout}) : reply(502, {error: ERRORS.upstream});
    } finally { clearTimeout(timer); }
    const u = message?.usage || {};
    stats.input_tokens += u.input_tokens || 0; stats.output_tokens += u.output_tokens || 0; stats.cache_read += u.cache_read_input_tokens || 0;
    stats.model = message?.model;
    if(message?.stop_reason === 'refusal') return reply(422, {error: ERRORS.refusal});
    const items = message?.stop_reason === 'max_tokens' ? null : readItems(message);
    const r = items ? applyRewrite(payload.analysis, payload.target, items) : {errors: ['Η απάντηση δεν ήταν JSON της μορφής {"items": [...]}.']};
    if(!r.errors.length) return reply(200, {items: items.map(s => s.trim()).filter(Boolean)});
    errors = r.errors;
    if(now() - t0 > timeout / 2) break;
  }
  stats.error = 'invalid-output';
  return reply(502, {error: ERRORS.bad});
}
