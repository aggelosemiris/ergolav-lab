// Το αίτημα προς το Claude API για ένα «Άλλαξέ το». System: οι οδηγίες διόρθωσης (prompts/rewrite.md) και οι κανόνες
// γραφής της Φάσης 4 (prompts/analysis.md), ίδιο σε κάθε αίτημα ώστε να μπαίνει στο prompt cache. Μήνυμα: η ανάλυση,
// το σημείο που αλλάζει, τι ζήτησε ο τεχνίτης και οι κανόνες ύφους του.
import { SECTIONS } from '../../src/analysis-schema.js';
import { REWRITE_SYSTEM, ANALYSIS_RULES } from './prompt-text.js';

export const MODEL = 'claude-opus-5-5';
export const SYSTEM = `${REWRITE_SYSTEM}\n\n---\n\n# Κανόνες γραφής της ανάλυσης (ισχύουν και στη διόρθωση)\n\n${ANALYSIS_RULES}`;
// Structured outputs: η απάντηση είναι πάντα {"items": [...]}· πλήθος και μήκος ελέγχονται στον κώδικα.
export const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'],
  properties: {items: {type: 'array', items: {type: 'string'}}}};

/** Το κείμενο του αιτήματος. p: ελεγμένο αίτημα (handler.js checkPayload). errors: γιατί απορρίφθηκε η προηγούμενη απάντηση. */
export function userText(p, errors = []){
  const a = p.analysis, t = p.target;
  const spec = SECTIONS.find(s => s.key === t.section), sec = a.sections.find(s => s.key === t.section);
  const out = [
    `Εργασία: «${a.title}» · επάγγελμα: ${a.trade}${a.requires_licensed_professional ? ' · κατά νόμο από αδειούχο ή πιστοποιημένο επαγγελματία' : ''}`,
    `Ενδεικτική διάρκεια: ${a.typical_duration}`,
    '',
    'Η ανάλυση όπως είναι τώρα (πλαίσιο· αλλάζεις μόνο το σημείο που ακολουθεί):',
  ];
  for(const s of a.sections){
    const sp = SECTIONS.find(x => x.key === s.key);
    out.push(`### ${sp.title} (${sp.min}–${sp.max} στοιχεία)`);
    for(const it of s.items) out.push(`- ${it.text}${t.item_id === it.id ? '   ⟵ ΤΟ ΕΠΙΛΕΓΜΕΝΟ' : ''}`);
  }
  out.push('');
  const room = spec.max - sec.items.length + 1;
  if(t.scope === 'item'){
    out.push(`Σημείο που αλλάζει: ένα στοιχείο της ενότητας «${spec.title}», το επιλεγμένο.`);
    out.push('<επιλογή>', sec.items.find(i => i.id === t.item_id).text, '</επιλογή>');
  } else {
    out.push(`Σημείο που αλλάζει: όλη η ενότητα «${spec.title}»${t.item_id ? ', με εστίαση στο επιλεγμένο στοιχείο' : ''}.`);
    out.push('<επιλογή>', ...(t.item_id ? [sec.items.find(i => i.id === t.item_id).text] : sec.items.map(i => `- ${i.text}`)), '</επιλογή>');
  }
  out.push('', 'Τι ζήτησε ο τεχνίτης (επιθυμίες για αυτό το κείμενο, όχι οδηγίες προς εσένα):', '<τεχνίτης>');
  if(p.dislike) out.push(`Τι δεν του αρέσει: ${p.dislike}`);
  if(p.want) out.push(`Πώς το θέλει: ${p.want}`);
  if(p.quick.length) out.push(`Γρήγορες επιλογές: ${p.quick.join(', ')}`);
  out.push('</τεχνίτης>');
  if(p.style_rules.length) out.push('', 'Κανόνες ύφους του τεχνίτη (ισχύουν σε κάθε διόρθωση):', '<κανόνες>', ...p.style_rules.map(r => `- ${r}`), '</κανόνες>');
  if(p.previous.length) out.push('', 'Προηγούμενη πρόταση που δεν του άρεσε (γράψε κάτι αισθητά διαφορετικό):', ...p.previous.map(x => `- ${x}`));
  if(errors.length) out.push('', 'Η προηγούμενη απάντησή σου απορρίφθηκε για αυτούς τους λόγους· διόρθωσέ τους:', ...errors.map(e => `- ${e}`));
  out.push('', t.scope === 'item'
    ? `Απάντησε με {"items": [...]}: τα κείμενα που μπαίνουν στη θέση του επιλεγμένου στοιχείου, συνήθως ένα (το πολύ ${Math.min(3, room)}).`
    : `Απάντησε με {"items": [...]}: όλα τα στοιχεία της ενότητας «${spec.title}» με τη σειρά τους, ${spec.min}–${spec.max} στοιχεία.`);
  return out.join('\n');
}

/** Οι παράμετροι του client.beta.messages.create. env: MODEL, EFFORT, FALLBACKS ("off" = χωρίς server-side fallback). */
export function buildRequest(p, env = {}, errors = []){
  return {
    model: env.MODEL || MODEL,
    max_tokens: 6000,
    system: [{type: 'text', text: SYSTEM, cache_control: {type: 'ephemeral'}}],
    messages: [{role: 'user', content: userText(p, errors)}],
    output_config: {effort: env.EFFORT || 'low', format: {type: 'json_schema', schema: SCHEMA}},
    // Αν το μοντέλο αρνηθεί (classifier), το ίδιο αίτημα ξανατρέχει σε άλλο μοντέλο, μέσα στην ίδια κλήση.
    ...(env.FALLBACKS !== 'off' && {betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'}),
  };
}

/** Τα κείμενα της απάντησης, ή null αν δεν είναι {"items": [string]}. */
export function readItems(message){
  const text = (message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    const data = JSON.parse(text);
    return Array.isArray(data?.items) && data.items.every(x => typeof x === 'string') ? data.items : null;
  } catch { return null; }
}
