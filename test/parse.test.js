import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';

const byId = (r, id) => r.lines.filter(l => l.id === id);

test('η φράση του demo', () => {
  const r = parse('Ανακαίνιση μπάνιου. Δώδεκα μέτρα σωλήνα πολυστρωματικό, μια μπαταρία νιπτήρα, λεκάνη κρεμαστή με καζανάκι εντοιχισμού, και δώδεκα τετραγωνικά πλακάκι τοίχου.');
  assert.equal(r.title, 'ανακαίνιση μπάνιου');
  assert.equal(byId(r, 'pipe')[0].qty, 12);
  const mixer = byId(r, 'mixer')[0];
  assert.equal(mixer.flag, undefined);
  assert.match(mixer.name, /νιπτήρα/);
  assert.equal(byId(r, 'basin').length, 0, 'το «μπαταρία νιπτήρα» δεν είναι νιπτήρας');
  assert.equal(byId(r, 'wc')[0].qty, 1);
  assert.match(byId(r, 'tank')[0].name, /εντοιχισμού/);
  const tile = byId(r, 'tile')[0];
  assert.equal(tile.qty, 12);
  assert.equal(tile.flag, true);
  assert.equal(tile.name, 'Πλακάκι τοίχου');
  const glue = byId(r, 'glue')[0];
  assert.equal(glue.suggest, true);
  assert.equal(glue.qty, 3);
  assert.equal(r.lines.filter(l => l.unknown).length, 0);
});

test('ομιλία χωρίς στίξη, ψηφία και σύνθετοι αριθμοί', () => {
  const r = parse('25 μέτρα σωλήνα και είκοσι πέντε τετραγωνικά πλακάκι δαπέδου γκρι και δύο διακόπτες');
  assert.equal(byId(r, 'pipe')[0].qty, 25);
  const tile = byId(r, 'tile')[0];
  assert.equal(tile.qty, 25);
  assert.equal(tile.flag, undefined);
  assert.match(tile.name, /δαπέδου 30×60 γκρι/);
  assert.equal(byId(r, 'valve')[0].qty, 2);
});

test('δεκαδικά και ενώνει ίδια υλικά', () => {
  const r = parse('3,5 μέτρα σωλήνα, 2 μέτρα σωλήνα');
  assert.equal(byId(r, 'pipe').length, 1);
  assert.equal(byId(r, 'pipe')[0].qty, 5.5);
});

test('κόλλα που ειπώθηκε δεν προτείνεται ξανά', () => {
  const r = parse('δέκα τετραγωνικά πλακάκι λευκό και πέντε σακιά κόλλα');
  const glue = byId(r, 'glue');
  assert.equal(glue.length, 1);
  assert.equal(glue[0].qty, 5);
  assert.equal(glue[0].suggest, undefined);
});

test('ό,τι δεν αναγνωρίζεται βγαίνει για έλεγχο', () => {
  const r = parse('τρία μέτρα σίτα αλουμινίου');
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].unknown, true);
});

test('σημειώσεις με συντομογραφίες και μία γραμμή ανά υλικό', () => {
  const r = parse('12 μ. σωλήνας\n2 τεμ. διακόπτες\n15 τ.μ. πλακάκι δαπέδου γκρι\nλεκάνη κρεμαστή');
  assert.equal(byId(r, 'pipe')[0].qty, 12);
  assert.equal(byId(r, 'valve')[0].qty, 2);
  assert.equal(byId(r, 'tile')[0].qty, 15);
  assert.equal(byId(r, 'wc')[0].qty, 1);
  assert.equal(r.lines.filter(l => l.unknown).length, 0);
});

test('λίστα με αρίθμηση/markdown και ποσότητα μετά το υλικό', () => {
  const r = parse('**Ανακαίνιση μπάνιου**\n1. Σωλήνας 12 μέτρα\n2. Διακόπτες 2 τεμάχια\n- 1 τεμάχιο λεκάνη');
  assert.equal(r.title, 'ανακαίνιση μπάνιου');
  assert.equal(byId(r, 'pipe')[0].qty, 12);
  assert.equal(byId(r, 'valve')[0].qty, 2);
  assert.equal(byId(r, 'wc')[0].qty, 1);
  assert.equal(r.lines.filter(l => l.unknown).length, 0);
});

test('υλικά εκτός καταλόγου κρατούν ποσότητα, μονάδα και περιγραφή', () => {
  const r = parse('2 τεμάχια κλιματιστικά\n5 μέτρα σίτα\nτζάκι');
  assert.deepEqual(r.lines.map(l => [l.unknown, l.qty, l.unit, l.name]),
    [[true, 2, 'τεμ.', 'Κλιματιστικά'], [true, 5, 'μ.', 'Σίτα'], [true, 1, 'τεμ.', 'Τζάκι']]);
});

test('συνηθισμένος τύπος όταν δεν ειπώθηκε, συγκεκριμένος όταν ειπώθηκε', () => {
  const r = parse('10 μέτρα σωλήνα, 4 μέτρα σωλήνα αποχέτευσης Φ110, μια λεκάνη, 2 διακόπτες φωτός, 3 βρύσες');
  assert.deepEqual(r.lines.map(l => [l.qty, l.name, !!l.flag]), [
    [10, 'Σωλήνας πολυστρωματικός Φ16', false],
    [4, 'Σωλήνας αποχέτευσης PVC Φ110', false],
    [1, 'Λεκάνη κρεμαστή', false],
    [2, 'Διακόπτης φωτός χωνευτός', false],
    [3, 'Βρύση απλή (κήπου/πλυντηρίου)', false],
  ]);
});

test('ανακαίνιση μπάνιου: εργασίες, οικοδομικά και ηλεκτρολογικά', () => {
  const r = parse('Αποξήλωση, 2 κάδοι μπάζα, 6 τετραγωνικά στεγάνωση, καμπίνα ντουζιέρας, μπανιέρα, 4 σποτ, 2 πρίζες, κόλλα πλακιδίων 3 σακιά');
  const ids = r.lines.map(l => l.id);
  assert.deepEqual(ids, ['demolition', 'debris', 'waterproof', 'cabin', 'bathtub', 'light', 'socket', 'glue']);
  assert.equal(byId(r, 'debris')[0].qty, 2);
  assert.equal(byId(r, 'glue')[0].qty, 3);
  assert.equal(byId(r, 'tile').length, 0, 'η «κόλλα πλακιδίων» δεν είναι πλακάκι');
});

test('διορθώσεις και αρνήσεις στην ομιλία', () => {
  assert.equal(byId(parse('12 μέτρα σωλήνα, όχι συγγνώμη, 15 μέτρα σωλήνα'), 'pipe')[0].qty, 15);
  assert.equal(byId(parse('δύο λεκάνες, όχι, τελικά μία λεκάνη'), 'wc')[0].qty, 1);
  assert.equal(byId(parse('δεν χρειάζεται θερμοσίφωνας, έχει ηλιακό'), 'heater').length, 0);
  assert.equal(byId(parse('όλα εκτός από την μπανιέρα'), 'bathtub').length, 0);
});

test('τιμές δεν γίνονται ποσότητες, παράλογες ποσότητες ζητούν επιβεβαίωση', () => {
  assert.equal(byId(parse('λεκάνη κρεμαστή 185€'), 'wc')[0].qty, 1);
  const wc = byId(parse('999 λεκάνες κρεμαστές'), 'wc')[0];
  assert.equal(wc.qty, 999);
  assert.equal(wc.qtyCheck, true);
  const tile = byId(parse('πλακάκι τοίχου λευκό'), 'tile')[0];
  assert.equal(tile.qtyMissing, true, 'δεν ειπώθηκαν τ.μ. — πρέπει να ζητηθούν');
  assert.equal(byId(parse('μία λεκάνη'), 'wc')[0].qtyMissing, undefined);
});

test('λέξεις που μοιάζουν αλλά σημαίνουν άλλο', () => {
  const r = parse('δέκα τετραγωνικά πορτοκαλί πλακάκι');
  assert.equal(byId(r, 'door').length, 0);
  assert.equal(byId(r, 'tile')[0].qty, 10);
  assert.equal(parse('να πάρω μπαταρία αυτοκινήτου').lines.filter(l => !l.unknown).length, 0);
  assert.equal(parse('θα το βρίσκεις στο ντουλάπι').lines.filter(l => l.id === 'tap').length, 0);
});

test('συνώνυμα, ορθογραφικά, αριθμοί, greeklish, αγγλικά', () => {
  assert.equal(byId(parse('ένα λαβομάνο'), 'basin').length, 1);
  assert.equal(byId(parse('ένα ρεζερβουάρ εντοιχισμού'), 'tank').length, 1);
  assert.equal(byId(parse('σολήνας 12 μετρα'), 'pipe')[0].qty, 12);
  assert.equal(byId(parse('δυόμισι μέτρα σωλήνα'), 'pipe')[0].qty, 2.5);
  assert.equal(byId(parse('εκατόν είκοσι πέντε μέτρα καλώδιο'), 'cable')[0].qty, 125);
  assert.equal(byId(parse('dwdeka metra swlina'), 'pipe')[0].qty, 12);
  const en = parse('12 meters of pipe and one toilet');
  assert.equal(byId(en, 'pipe')[0].qty, 12);
  assert.equal(byId(en, 'wc')[0].qty, 1);
});

test('καθάρισμα εξόδου μοντέλου (εισαγωγή, markdown πίνακας)', () => {
  const r = parse('Ορίστε οι σημειώσεις που διάβασα:\n| Υλικό | Ποσότητα |\n|---|---|\n| Σωλήνας | 12 μ. |\n| Λεκάνη | 1 |');
  assert.deepEqual(r.lines.map(l => [l.id, l.qty]), [['pipe', 12], ['wc', 1]]);
});

// ── Test #3: διόρθωση ποσότητας χωρίς επανάληψη υλικού (συντηρητικά) ──
const cat = r => r.lines.filter(l => !l.unknown && !l.suggest);

test('#3 «12 μέτρα σωλήνα, όχι, τελικά 15 μέτρα» → 15 μ. σωλήνας', () => {
  const r = parse('12 μέτρα σωλήνα, όχι, τελικά 15 μέτρα');
  assert.deepEqual(r.lines.map(l => [l.id, l.qty, l.unit]), [['pipe', 15, 'μ.']], 'ούτε 27, ούτε άγνωστη γραμμή');
});

test('#3 «12 μέτρα σωλήνα, τελικά 15» → χωρίς μονάδα δεν αλλάζει σιωπηλά (μ. ≠ τεμάχια)', () => {
  const r = parse('12 μέτρα σωλήνα, τελικά 15');
  assert.equal(byId(r, 'pipe')[0].qty, 12, 'ο σωλήνας δεν αντικαθίσταται χωρίς απόδειξη μονάδας');
  assert.equal(r.lines.filter(l => l.unknown && l.qty === 15).length, 1, 'το 15 μένει ορατό για έλεγχο, δεν χάνεται');
});

test('#3 «12 μέτρα σωλήνα και 15 πλακάκια» → δεν είναι διόρθωση του σωλήνα', () => {
  const r = parse('12 μέτρα σωλήνα και 15 πλακάκια');
  assert.equal(byId(r, 'pipe')[0].qty, 12);
  assert.equal(byId(r, 'tile')[0].qty, 15);
});

test('#3 «12 μέτρα σωλήνα, όχι 15 τεμάχια» → ασύμβατη μονάδα, καμία αντικατάσταση', () => {
  const r = parse('12 μέτρα σωλήνα, όχι 15 τεμάχια');
  assert.equal(byId(r, 'pipe')[0].qty, 12);
  assert.equal(r.lines.filter(l => l.unknown && l.qty === 15).length, 1, 'το 15 τεμ. μένει ορατό για έλεγχο');
});

test('#3 «2 λεκάνες, όχι, τελικά 3» → 3 λεκάνες (τεμάχια: σκέτος αριθμός χωρίς αμφισημία)', () => {
  const r = parse('2 λεκάνες, όχι, τελικά 3');
  assert.deepEqual(cat(r).map(l => [l.id, l.qty]), [['wc', 3]]);
  assert.equal(r.lines.filter(l => l.unknown).length, 0);
});

test('#3 η αντικατάσταση αφορά μόνο το ΑΜΕΣΩΣ προηγούμενο υλικό και μόνο με λέξη διόρθωσης', () => {
  // το αμέσως προηγούμενο είναι η λεκάνη (τεμ.) → «15 μέτρα» ασύμβατο → κανένα από τα δύο δεν αλλάζει
  const r1 = parse('12 μέτρα σωλήνα, μία λεκάνη, όχι, τελικά 15 μέτρα');
  assert.equal(byId(r1, 'pipe')[0].qty, 12);
  assert.equal(byId(r1, 'wc')[0].qty, 1);
  // χωρίς λέξη διόρθωσης: ο αριθμός δεν συνδέεται με το προηγούμενο υλικό
  const r2 = parse('12 μέτρα σωλήνα, 15 μέτρα');
  assert.equal(byId(r2, 'pipe')[0].qty, 12);
  // άλλες λέξεις στη φράση → όχι αυτόματη αντικατάσταση
  const r3 = parse('12 μέτρα σωλήνα, όχι, τελικά 15 μέτρα από την κουζίνα');
  assert.equal(byId(r3, 'pipe')[0].qty, 12);
});

// ── Αριθμοί που περιγράφουν το προϊόν (διάσταση, λίτρα, εκατοστά) δεν είναι ποσότητα ──
const row = l => [l.name, l.qty, l.unit, !!l.qtyMissing];

test('διάσταση πλακακιού: «30 επί 60» δεν γίνεται 30 τ.μ., μπαίνει στο όνομα', () => {
  for(const t of ['πλακάκι 30 επί 60, δεκαπέντε τετραγωνικά', 'πλακάκι 30 επί 60 δεκαπέντε τετραγωνικά', 'πλακάκι 30x60 15 τ.μ.', 'πλακάκι 30 χ 60, 15 τετραγωνικά']){
    const r = parse(t);
    assert.deepEqual(row(byId(r, 'tile')[0]), ['Πλακάκι 30×60', 15, 'τ.μ.', false], t);
    assert.equal(byId(r, 'glue')[0].qty, 4, `κόλλα από τα 15 τ.μ. (όχι 7): ${t}`);
  }
  assert.deepEqual(row(byId(parse('δεκαπέντε τετραγωνικά πλακάκι είκοσι επί είκοσι'), 'tile')[0]), ['Πλακάκι 20×20', 15, 'τ.μ.', false]);
});

test('διάσταση που ταιριάζει με τον τύπο δεν γράφεται δύο φορές', () => {
  const tile = byId(parse('πλακάκι 30χ60 λευκό 15 τετραγωνικά'), 'tile')[0];
  assert.equal(tile.name, 'Πλακάκι 30×60 λευκό ματ');
  assert.equal(tile.qty, 15);
  assert.equal(tile.flag, undefined);
  assert.equal(byId(parse('πλακάκι τοίχου 30 επί 60 λευκό, 10 τετραγωνικά'), 'tile')[0].name, 'Πλακάκι τοίχου 30×60 λευκό ματ');
});

test('διάσταση που ΔΕΝ ταιριάζει με τον τύπο → ρωτάει τύπο (όχι σιωπηλά 30×60)', () => {
  const tile = byId(parse('πλακάκι 20 επί 20 λευκό, 10 τετραγωνικά'), 'tile')[0];
  assert.equal(tile.flag, true);
  assert.equal(tile.qty, 10);
  assert.equal(tile.name, 'Πλακάκι 20×20');
});

test('σκέτο «πλακάκι 30 επί 60» → ζητάει ποσότητα (όχι 30 τ.μ., όχι σιωπηλά 1 τ.μ.)', () => {
  const tile = byId(parse('πλακάκι 30 επί 60'), 'tile')[0];
  assert.equal(tile.name, 'Πλακάκι 30×60');
  assert.equal(tile.qtyMissing, true);
});

test('ποσότητα σε χωριστή φράση συμπληρώνει μόνο ποσότητα που έλειπε, και μόνο με ίδια μονάδα', () => {
  assert.deepEqual(row(byId(parse('πλακάκι λευκό, 15 τετραγωνικά'), 'tile')[0]), ['Πλακάκι 30×60 λευκό ματ', 15, 'τ.μ.', false]);
  assert.equal(byId(parse('πλακάκι λευκό, 15'), 'tile')[0].qtyMissing, true, 'χωρίς μονάδα δεν συνδέεται');
  assert.equal(byId(parse('πλακάκι λευκό, 15 μέτρα'), 'tile')[0].qtyMissing, true, 'άλλη μονάδα δεν συνδέεται');
  assert.equal(byId(parse('10 τετραγωνικά πλακάκι λευκό, 15 τετραγωνικά'), 'tile')[0].qty, 10, 'χωρίς διόρθωση δεν αντικαθιστά');
});

test('λίτρα / εκατοστά σε τεμάχια: 1 τεμάχιο, όχι 80', () => {
  for(const [t, id] of [['θερμοσίφωνας ογδόντα λίτρα', 'heater'], ['θερμοσίφωνας 80 λίτρων', 'heater'], ['έπιπλο μπάνιου 80 εκατοστά', 'vanity'],
    ['έπιπλο μπάνιου 80 εκ.', 'vanity'], ['έπιπλο 80 πόντους', 'vanity']]){
    const l = byId(parse(t), id)[0];
    assert.equal(l.qty, 1, t);
    assert.equal(l.qtyCheck, false, t);
    assert.equal(l.qtyMissing, undefined, `τεμάχια: όπως πριν, χωρίς ερώτηση — ${t}`);
  }
  assert.equal(byId(parse('δύο θερμοσίφωνες 80 λίτρα'), 'heater')[0].qty, 2);
  assert.equal(byId(parse('θερμοσίφωνας 80 λίτρα δύο τεμάχια'), 'heater')[0].qty, 2);
});

test('μονάδες ποσότητας δεν αλλάζουν: μέτρα, τετραγωνικά, τεμάχια, σακιά', () => {
  assert.equal(byId(parse('10 μέτρα σωλήνα'), 'pipe')[0].qty, 10);
  assert.deepEqual(row(byId(parse('σωλήνας 20 χιλιοστά 10 μέτρα'), 'pipe')[0]).slice(1), [10, 'μ.', false]);
  assert.equal(byId(parse('σωλήνας 20 χιλ. 10 μέτρα'), 'pipe')[0].qty, 10);
  assert.equal(byId(parse('3 σακιά κόλλα'), 'glue')[0].qty, 3);
  assert.equal(byId(parse('2 τεμάχια διακόπτες'), 'valve')[0].qty, 2);
  assert.equal(byId(parse('δύο λεκάνες, όχι 3, τελικά 2 λεκάνες'), 'wc')[0].qty, 2);
  assert.equal(byId(parse('12 μέτρα σωλήνα, όχι, τελικά 15 μέτρα'), 'pipe')[0].qty, 15);
});

// ── Νιπτήρας + έπιπλο στην ίδια φράση: το έπιπλο έχει ήδη νιπτήρα ──
test('«νιπτήρας με έπιπλο» → μόνο το έπιπλο (όχι διπλή χρέωση)', () => {
  for(const t of ['νιπτήρας με έπιπλο', 'έπιπλο με νιπτήρα', 'έπιπλο μπάνιου με νιπτήρα', 'ένας νιπτήρας με έπιπλο μπάνιου']){
    const r = parse(t);
    assert.deepEqual(cat(r).map(l => [l.id, l.qty]), [['vanity', 1]], t);
  }
});

test('νιπτήρας και έπιπλο που δεν είναι ένα: μένουν και τα δύο', () => {
  assert.deepEqual(cat(parse('νιπτήρας')).map(l => [l.id, l.qty]), [['basin', 1]]);
  assert.deepEqual(cat(parse('δύο νιπτήρες και ένα έπιπλο')).map(l => [l.id, l.qty]), [['basin', 2], ['vanity', 1]]);
  assert.deepEqual(cat(parse('δύο νιπτήρες, ένα έπιπλο')).map(l => [l.id, l.qty]), [['basin', 2], ['vanity', 1]]);
  assert.deepEqual(cat(parse('νιπτήρας χωρίς έπιπλο')).map(l => [l.id, l.qty]), [['basin', 1]]);
});

test('«δύο νιπτήρες με έπιπλο» → ένα έπιπλο, αλλά ζητάει ποσότητα (το «δύο» δεν χάνεται σιωπηλά)', () => {
  const r = parse('δύο νιπτήρες με έπιπλο');
  assert.deepEqual(cat(r).map(l => [l.id, !!l.qtyMissing]), [['vanity', true]]);
  assert.equal(byId(parse('δύο έπιπλα με νιπτήρα'), 'vanity')[0].qty, 2);
  assert.equal(byId(parse('δύο έπιπλα με νιπτήρα'), 'vanity')[0].qtyMissing, undefined);
});

// ── Μέγεθος που είπε ο χρήστης ≠ μέγεθος του είδους στον κατάλογο → η γραμμή ρωτάει ──
// Μέγεθος που ΔΕΝ υπάρχει στον κατάλογο: ερώτηση με τα δύο πιο κοντινά (στα 120 λ., 60 εκ., 90×90 που υπήρχαν
// εδώ πριν, ο κατάλογος έχει πλέον τύπο — βλ. «μέγεθος που υπάρχει στον κατάλογο» παρακάτω).
const sc = l => l.sizeCheck && [l.sizeCheck.said, l.sizeCheck.near.map(o => o.label)];
test('άλλο μέγεθος από τον κατάλογο → ρωτάει (όχι σιωπηλά άλλο είδος)', () => {
  assert.deepEqual(sc(byId(parse('θερμοσίφωνας 90 λίτρα'), 'heater')[0]), ['90 λ.', ['80 λ.', '100 λ.']]);
  assert.deepEqual(sc(byId(parse('έπιπλο 70 εκατοστά'), 'vanity')[0]), ['70 εκ.', ['60 εκ.', '80 εκ.']]);
  assert.deepEqual(sc(byId(parse('ντουζιέρα 100 επί 100'), 'shower')[0]), ['100×100', ['80×80', '90×90']]);
});

test('ίδιο μέγεθος με τον κατάλογο → δεν ρωτάει', () => {
  assert.ok(!byId(parse('θερμοσίφωνας 80 λίτρα'), 'heater')[0].sizeCheck);
  assert.ok(!byId(parse('έπιπλο μπάνιου 80 εκατοστά'), 'vanity')[0].sizeCheck);
  assert.ok(!byId(parse('έπιπλο 800 χιλιοστά'), 'vanity')[0].sizeCheck, '800 χιλ. = 80 εκ.');
  assert.ok(!byId(parse('ντουζιέρα 80x80'), 'shower')[0].sizeCheck);
  assert.ok(!byId(parse('θερμοσίφωνας'), 'heater')[0].sizeCheck, 'χωρίς μέγεθος: όπως πριν');
  assert.ok(!byId(parse('πλακάκι 30 επί 60 15 τετραγωνικά'), 'tile')[0].sizeCheck, 'το πλακάκι δεν έχει μέγεθος στον κατάλογο');
});

test('μέγεθος: διόρθωση καθαρίζει την ερώτηση, διαφορετικά μεγέθη δεν ενώνονται', () => {
  assert.ok(!byId(parse('θερμοσίφωνας 90 λίτρα, όχι, θερμοσίφωνας 80 λίτρα'), 'heater')[0].sizeCheck);
  const two = byId(parse('θερμοσίφωνας 80 λίτρα. θερμοσίφωνας 90 λίτρα'), 'heater');
  assert.deepEqual(two.map(l => [l.qty, !!l.sizeCheck]), [[1, false], [1, true]]);
});

// ── Μεγέθη / τύποι στον κατάλογο ──
const pick = (t, id) => byId(parse(t), id)[0];
test('μέγεθος που υπάρχει στον κατάλογο → αυτό, με την τιμή του, χωρίς ερώτηση', () => {
  for(const [t, id, name, code, mat] of [
    ['θερμοσίφωνας 100 λίτρα', 'heater', 'Θερμοσίφωνας 100 λ.', 'ΚΩΔ. 30100', 30000],
    ['θερμοσίφωνας 120 λίτρα', 'heater', 'Θερμοσίφωνας 120 λ.', 'ΚΩΔ. 30120', 34000],
    ['έπιπλο 60 εκατοστά', 'vanity', 'Έπιπλο μπάνιου με νιπτήρα 60 εκ.', 'ΚΩΔ. 23160', 22000],
    ['έπιπλο 1000 χιλιοστά', 'vanity', 'Έπιπλο μπάνιου με νιπτήρα 100 εκ.', 'ΚΩΔ. 23200', 36000],
    ['ντουζιέρα 90 επί 90', 'shower', 'Ντουζιέρα 90×90', 'ΚΩΔ. 24090', 16500],
    ['ντουζιέρα 120 επί 80', 'shower', 'Ντουζιέρα 80×120', 'ΚΩΔ. 24120', 21000],
    ['μπανιέρα 150 επί 70', 'bathtub', 'Μπανιέρα ακρυλική 150×70', 'ΚΩΔ. 24150', 21000],
    ['νιπτήρας 50 εκατοστά', 'basin', 'Νιπτήρας πορσελάνης 50 εκ.', 'ΚΩΔ. 23050', 6200],
    ['νεροχύτης δύο γούρνες', 'sink', 'Νεροχύτης ανοξείδωτος 2 γούρνες', 'ΚΩΔ. 25120', 18000],
    ['νεροχύτης μιάμιση γούρνα', 'sink', 'Νεροχύτης ανοξείδωτος 1½ γούρνα', 'ΚΩΔ. 25115', 15000],
    ['σπιράλ 50 εκατοστά', 'hose', 'Σπιράλ σύνδεσης 50 εκ.', 'ΚΩΔ. 25250', 520],
    ['συλλέκτης 6 εξόδων', 'manifold', 'Συλλέκτης νερού 6 εξόδων', 'ΚΩΔ. 27006', 6400],
    ['πόρτα 90 εκατοστά', 'door', 'Πόρτα εσωτερική laminate 90 εκ.', 'ΚΩΔ. 98090', 19500],
    ['καμπίνα 80 επί 120', 'cabin', 'Καμπίνα ντουζιέρας γυάλινη 80×120', 'ΚΩΔ. 24212', 31000],
  ]){
    const l = pick(t, id);
    assert.deepEqual([l.name, l.code, l.mat, !!l.sizeCheck, !!l.flag, l.qty], [name, code, mat, false, false, 1], t);
  }
});

test('χωρίς μέγεθος: ο συνηθισμένος τύπος με την ΙΔΙΑ τιμή όπως πριν, χωρίς κλείδωμα', () => {
  for(const [t, id, name, code, mat, lab] of [
    ['θερμοσίφωνας', 'heater', 'Θερμοσίφωνας 80 λ.', 'ΚΩΔ. 30080', 26000, 6000],
    ['έπιπλο', 'vanity', 'Έπιπλο μπάνιου με νιπτήρα 80 εκ.', 'ΚΩΔ. 23080', 28000, 6000],
    ['ντουζιέρα', 'shower', 'Ντουζιέρα 80×80', 'ΚΩΔ. 24080', 14000, 8000],
    ['μπανιέρα', 'bathtub', 'Μπανιέρα ακρυλική 170×70', 'ΚΩΔ. 24170', 25000, 12000],
    ['νιπτήρας', 'basin', 'Νιπτήρας πορσελάνης 60 εκ.', 'ΚΩΔ. 23060', 7500, 4000],
    ['νεροχύτης', 'sink', 'Νεροχύτης ανοξείδωτος 1 γούρνα', 'ΚΩΔ. 25100', 12000, 6000],
    ['συλλέκτης', 'manifold', 'Συλλέκτης νερού 4 εξόδων', 'ΚΩΔ. 27004', 4500, 4000],
    ['10 μέτρα καλώδιο', 'cable', 'Καλώδιο ΝΥΜ 3×1,5', 'ΚΩΔ. 61015', 120, 250],
    ['20 τετραγωνικά βάψιμο', 'paint', 'Βάψιμο τοίχων πλαστικό 2 χέρια', 'ΚΩΔ. 97100', 200, 600],
    ['10 μέτρα σωλήνα', 'pipe', 'Σωλήνας πολυστρωματικός Φ16', 'ΚΩΔ. 40216', 190, 600],
  ]){
    const l = pick(t, id);
    assert.deepEqual([l.name, l.code, l.mat, l.lab, !!l.sizeCheck, !!l.flag], [name, code, mat, lab, false, false], t);
  }
});

test('διατομή καλωδίου: «καλώδιο 2,5» = 3×2,5 (όχι 2,5 μ.)· με μονάδα ή χωρίς τέτοιο τύπο = ποσότητα', () => {
  const a = pick('καλώδιο 2,5', 'cable');
  assert.deepEqual([a.name, a.qtyMissing], ['Καλώδιο ΝΥΜ 3×2,5', true], 'ο τύπος μπαίνει, η ποσότητα ζητείται');
  assert.deepEqual([pick('20 μέτρα καλώδιο 2,5', 'cable').name, pick('20 μέτρα καλώδιο 2,5', 'cable').qty], ['Καλώδιο ΝΥΜ 3×2,5', 20]);
  assert.equal(pick('καλώδιο 3 επί 4, 15 μέτρα', 'cable').name, 'Καλώδιο ΝΥΜ 3×4');
  assert.deepEqual([pick('καλώδιο 4 μέτρα', 'cable').name, pick('καλώδιο 4 μέτρα', 'cable').qty], ['Καλώδιο ΝΥΜ 3×1,5', 4]);
  assert.equal(pick('καλώδιο 25 μέτρα', 'cable').qty, 25);
});

test('νέοι τύποι σωλήνα και βάψιμο με χέρια', () => {
  assert.equal(pick('σωλήνας Φ26 10 μέτρα', 'pipe').name, 'Σωλήνας πολυστρωματικός Φ26');
  assert.equal(pick('σωλήνας PPR Φ25 10 μέτρα', 'pipe').name, 'Σωλήνας PPR Φ25');
  assert.equal(pick('σωλήνας PPR 10 μέτρα', 'pipe').name, 'Σωλήνας PPR Φ20');
  const p = pick('βάψιμο 40 τετραγωνικά τρία χέρια', 'paint');
  assert.deepEqual([p.name, p.qty], ['Βάψιμο τοίχων πλαστικό 3 χέρια', 40], '«τρία χέρια» δεν είναι ποσότητα');
});

test('κάθε γραμμή με τύπους κρατά τη λίστα τους (για τα κουμπιά της κάρτας)', () => {
  const l = pick('θερμοσίφωνας', 'heater');
  assert.deepEqual(l.options.map(o => o.label), ['60 λ.', '80 λ.', '100 λ.', '120 λ.', '160 λ.']);
  assert.deepEqual(l.pick(l.options[2]), {name: 'Θερμοσίφωνας 100 λ.', code: 'ΚΩΔ. 30100', mat: 30000, lab: 6500, use: undefined});
});

// ── Κατανάλωση: κόλλα / αρμόστοκος από τα τ.μ. πλακακιού ──
import { calcParts } from '../src/parse.js';
test('κόλλα και αρμόστοκος προτείνονται από τα πλακάκια, με κατανάλωση ανά τύπο', () => {
  const r = parse('15 τετραγωνικά πλακάκι λευκό');
  const glue = byId(r, 'glue')[0], grout = byId(r, 'grout')[0];
  assert.deepEqual([glue.qty, glue.suggest, calcParts(glue, r.lines).rate], [4, true, 5], '15 × 5 × 1,1 / 25 = 3,3 → 4');
  assert.deepEqual([grout.qty, grout.suggest, calcParts(grout, r.lines).rate], [2, true, 0.4], '15 × 0,4 × 1,1 / 5 = 1,32 → 2');
  const m = parse('15 τετραγωνικά πλακάκι μάρμαρο');
  assert.equal(byId(m, 'glue')[0].qty, 5, '60×120: 7 kg/τ.μ. → 15 × 7 × 1,1 / 25 = 4,62 → 5');
  assert.equal(byId(m, 'grout')[0].qty, 1);
});

test('κατανάλωση: δική του κατανάλωση/φύρα, πηγές χωρίς ποσότητα δεν μετράνε, ακέραιες συσκευασίες χωρίς λάθος στρογγυλοποίησης', () => {
  const r = parse('15 τετραγωνικά πλακάκι λευκό');
  const glue = byId(r, 'glue')[0];
  glue.calc.rate = 7;
  assert.equal(calcParts(glue, r.lines).qty, 5);
  glue.calc.rate = 5; glue.calc.waste = 0;
  byId(r, 'tile')[0].qty = 25;
  assert.equal(calcParts(glue, r.lines).qty, 5, '25 × 5 / 25 = 5 ακριβώς, όχι 6');
  const missing = parse('πλακάκι λευκό');
  assert.equal(byId(missing, 'glue')[0].qty, 0, 'τ.μ. που δεν ειπώθηκαν δεν γίνονται 1 σακί');
  assert.equal(byId(parse('δέκα τετραγωνικά πλακάκι λευκό και πέντε σακιά κόλλα'), 'glue')[0].calc, undefined, 'ό,τι ειπώθηκε δεν υπολογίζεται');
});

// ════ Υλικά που χάνονταν, «ντους», διπλές γραμμές, εργασία από τη φωνή ════
const L = t => parse(t).lines;
const row2 = l => [l.id, l.name, l.qty];

test('1α βάνες, γωνίες, ρακόρ, ταυ: στον κατάλογο, με τύπους', () => {
  assert.deepEqual(row2(L('2 βάνες')[0]), ['ballvalve', 'Βάνα σφαιρική 1/2"', 2]);
  assert.deepEqual(row2(L('δύο βάνες 3/4')[0]), ['ballvalve', 'Βάνα σφαιρική 3/4"', 2], '«3/4» είναι ίντσες, όχι ποσότητα');
  assert.equal(L('βάνα μισή ίντσα')[0].name, 'Βάνα σφαιρική 1/2"');
  assert.equal(L('βάνα 1 ίντσα')[0].name, 'Βάνα σφαιρική 1"');
  assert.deepEqual(row2(L('6 γωνίες')[0]), ['elbow', 'Γωνία πολυστρωματική Φ16', 6]);
  assert.deepEqual(row2(L('4 γωνάκια φ26')[0]), ['elbow', 'Γωνία πολυστρωματική Φ26', 4]);
  assert.deepEqual(row2(L('10 ρακόρ')[0]), ['coupling', 'Ρακόρ / σύνδεσμος Φ16', 10]);
  assert.deepEqual(row2(L('3 σύνδεσμοι Φ20')[0]), ['coupling', 'Ρακόρ / σύνδεσμος Φ20', 3]);
  assert.deepEqual(row2(L('4 ταυ')[0]), ['tee', 'Ταυ πολυστρωματικό Φ16', 4]);
  assert.deepEqual(row2(L('2 ταφ')[0]), ['tee', 'Ταυ πολυστρωματικό Φ16', 2]);
  assert.equal(L('γωνιακός διακόπτης')[0].id, 'valve', '«γωνιακός» δεν είναι γωνία');
});

test('1α εξαρτήματα χωρίς διάμετρο παίρνουν του πολυστρωματικού σωλήνα της προσφοράς', () => {
  const r = L('12 μέτρα σωλήνα πολυστρωματικό Φ20, 6 γωνίες, 10 ρακόρ, 4 ταυ, 2 γωνίες φ26');
  assert.deepEqual(r.filter(l => l.id !== 'pipe').map(l => l.name),
    ['Γωνία πολυστρωματική Φ20', 'Ρακόρ / σύνδεσμος Φ20', 'Ταυ πολυστρωματικό Φ20', 'Γωνία πολυστρωματική Φ26']);
  const two = L('10 μέτρα σωλήνα Φ16, 5 μέτρα σωλήνα Φ20, 6 γωνίες');
  assert.equal(two.find(l => l.id === 'elbow').name, 'Γωνία πολυστρωματική Φ16', 'δύο διάμετροι: η προεπιλογή, ορατή στην κάρτα');
  assert.equal(L('10 μέτρα σωλήνα PPR, 6 γωνίες').find(l => l.id === 'elbow').name, 'Γωνία πολυστρωματική Φ16', 'PPR δεν μετράει');
});

test('1β υλικό εκτός καταλόγου με ποσότητα + ουσιαστικό → κάρτα (keep)', () => {
  for(const [t, name, qty] of [['3 σίτες', 'Σίτες', 3], ['2 τεμάχια κλιματιστικά', 'Κλιματιστικά', 2], ['δύο ρίζες', 'Ρίζες', 2], ['5 μέτρα σίτα', 'Σίτα', 5]]){
    const l = L(t)[0];
    assert.deepEqual([l.unknown, l.keep, l.name, l.qty, l.said], [true, true, name, qty, t], t);
  }
});

test('1β ΔΕΝ γίνονται προϊόντα: τηλέφωνα, ονόματα, ώρες, ποσά σε ευρώ, διευθύνσεις', () => {
  for(const t of ['μπάνιο για τον κύριο Παπαδόπουλο στο 6912345678', 'στις 10 το πρωί', 'στις 10:30', 'σε 3 μέρες', '100 ευρώ', '250€',
    'οδός Ερμού 25', '2ος όροφος', 'τηλ 210 1234567', 'και 2', 'όχι, συγγνώμη']){
    assert.ok(!L(t).some(l => l.keep), t);
  }
  const r = parse('μπάνιο για τον κύριο Παπαδόπουλο στο 6912345678. 12 μέτρα σωλήνα. 3 σίτες');
  assert.deepEqual(r.lines.filter(l => !l.unknown || l.keep).map(l => l.name), ['Σωλήνας πολυστρωματικός Φ16', 'Σίτες']);
});

test('2 «σετ ντους» / «κολόνα ντους» / «μπάρα ντους» → σετ ντους· «ντουζιέρα/ντουσιέρα» → ντουζιέρα', () => {
  assert.deepEqual(row2(L('σετ ντους')[0]), ['showerset', 'Σετ ντους απλό με μπάρα', 1]);
  assert.deepEqual(row2(L('σετ ντους με μπάρα')[0]), ['showerset', 'Σετ ντους απλό με μπάρα', 1]);
  assert.deepEqual(row2(L('κολόνα ντους θερμοστατική')[0]), ['showerset', 'Σετ ντους κολόνα θερμοστατική', 1]);
  assert.deepEqual(row2(L('μπάρα ντους')[0]), ['showerset', 'Σετ ντους απλό με μπάρα', 1]);
  assert.equal(L('σετ ντους').length, 1, 'μία γραμμή, όχι και ντουζιέρα');
  assert.equal(L('ντουζιέρα')[0].id, 'shower');
  assert.equal(L('ντουσιέρα 90 επί 90')[0].name, 'Ντουζιέρα 90×90');
  assert.equal(L('μπαταρία ντους')[0].name, 'Μπαταρία ντουζιέρας θερμοστατική', '«μπαταρία ντους» δεν ρωτάει ντουζιέρα/σετ');
});

test('2 σκέτο «ντους» → ρωτάει «Ντουζιέρα ή σετ ντους;»', () => {
  const l = L('ντους')[0];
  assert.deepEqual([l.flag, l.name, l.choose.map(c => c.id)], [true, 'Ντουζιέρα ή σετ ντους;', ['shower', 'showerset']]);
  assert.equal(L('ένα ντους')[0].choose.length, 2);
});

test('3α μηχανισμός καζανακιού: δεν γεννάει δεύτερη γραμμή καζανακιού', () => {
  const r = L('λεκάνη κρεμαστή με καζανάκι εντοιχισμού, μηχανισμός καζανακιού');
  assert.deepEqual(r.map(l => l.name), ['Λεκάνη κρεμαστή', 'Καζανάκι εντοιχισμού', 'Μηχανισμός καζανακιού']);
  assert.deepEqual(L('βαλβίδα καζανακιού').map(l => l.name), ['Μηχανισμός καζανακιού']);
  assert.deepEqual(L('φλοτέρ καζανακιού').map(l => l.name), ['Φλοτέρ καζανακιού']);
});

test('3β το ίδιο υλικό δύο φορές → μία γραμμή που ρωτάει «1 ή 2;»', () => {
  const l = L('λεκάνη κρεμαστή. και μια λεκάνη κρεμαστή')[0];
  assert.deepEqual([L('λεκάνη κρεμαστή. και μια λεκάνη κρεμαστή').length, l.qty, l.dupAsk], [1, 2, {times: 2, opts: [1, 2]}]);
  assert.deepEqual(L('3,5 μέτρα σωλήνα, 2 μέτρα σωλήνα')[0].dupAsk.opts, [2, 3.5, 5.5]);
  assert.equal(L('δύο λεκάνες, όχι, τελικά μία λεκάνη')[0].dupAsk, undefined, 'διόρθωση δεν είναι διπλή αναφορά');
  assert.equal(L('2 κάδοι μπάζα')[0].dupAsk, undefined);
  const t = L('πλακάκι λευκό, 15 τετραγωνικά πλακάκι λευκό').find(l => l.id === 'tile');
  assert.deepEqual([t.qty, t.dupAsk], [15, undefined], 'αναφορά χωρίς τ.μ. δεν αθροίζεται ως 1 (ήταν 16)');
});

test('4 εργασία από τη φωνή: ποσό στην εργασία, όχι γραμμή υλικού', () => {
  for(const [t, cents] of [['Εργασία 1.200 ευρώ', 120000], ['εργασία 1.200€', 120000], ['η εργασία χίλια διακόσια', 120000],
    ['για εργασία 1200', 120000], ['εργασία 850,50 ευρώ', 85050], ['εργασία δύο χιλιάδες πεντακόσια ευρώ', 250000]]){
    const r = parse(t);
    assert.deepEqual([r.labor, r.lines.length], [{cents}, 0], t);
  }
});

test('4 ασαφές ποσό εργασίας → δεν μπαίνει, ρωτάει', () => {
  for(const [t, ask] of [['εργασία 1.5 ευρώ', '1.5 ευρώ'], ['εργασία 1.20 ευρώ', '1.20 ευρώ'], ['εργασία 1.200', '1.200']]){
    const r = parse(t);
    assert.deepEqual([r.labor, r.lines.length], [{ask}, 0], t);
  }
  assert.equal(parse('εργασία τοποθέτησης').labor, null, 'χωρίς ποσό: δεν είναι εργασία');
  assert.equal(parse('10 μέτρα σωλήνα').labor, null);
});

test('αριθμοί με λέξεις: χιλιάδες', () => {
  assert.equal(byId(parse('χίλια διακόσια μέτρα καλώδιο'), 'cable')[0].qty, 1200, 'ήταν σιωπηλά 200');
  assert.equal(byId(parse('χίλια διακόσια πενήντα μέτρα καλώδιο'), 'cable')[0].qty, 1250);
  assert.equal(byId(parse('εκατόν είκοσι πέντε μέτρα καλώδιο'), 'cable')[0].qty, 125);
});

// ════ Κάθε άγνωστο υλικό = γραμμή προϊόντος (keep)· ό,τι δεν είναι υλικό δεν γίνεται ποτέ ════
import { scrub } from '../src/parse.js';
const kept = t => parse(t).lines.filter(l => !l.unknown || l.keep);
const short = l => [l.unknown ? 'unknown' : l.id, l.name, l.qty, l.unit];

test('«…μπαταρία νιπτήρα, ροπ» → 4 γραμμές: το «ροπ» (χωρίς ποσότητα) δεν χάνεται', () => {
  assert.deepEqual(kept('ανακαίνιση μπάνιου 12 μέτρα σωλήνα, μία μπανιέρα, μία μπαταρία νιπτήρα, ροπ').map(short), [
    ['pipe', 'Σωλήνας πολυστρωματικός Φ16', 12, 'μ.'], ['bathtub', 'Μπανιέρα ακρυλική 170×70', 1, 'τεμ.'],
    ['mixer', 'Μπαταρία νιπτήρα αναμεικτική', 1, 'τεμ.'], ['unknown', 'Ροπ', 1, 'τεμ.']]);
});

test('ποσότητα και μονάδα όπως ειπώθηκαν, αλλιώς 1 τεμ.', () => {
  assert.deepEqual(short(kept('3 μέτρα ροπ')[0]), ['unknown', 'Ροπ', 3, 'μ.']);
  assert.deepEqual(short(kept('3 ροπ')[0]), ['unknown', 'Ροπ', 3, 'τεμ.']);
  assert.deepEqual(short(kept('2 σακιά γαρμπίλι')[0]), ['unknown', 'Γαρμπίλι', 2, 'σακί']);
  assert.deepEqual(short(kept('τζάκι')[0]), ['unknown', 'Τζάκι', 1, 'τεμ.']);
  assert.deepEqual(short(kept('θέλω ροπ')[0]), ['unknown', 'Ροπ', 1, 'τεμ.'], '«θέλω» δεν είναι μέρος του ονόματος');
  assert.deepEqual(short(kept('βάλε και 2 σίτες')[0]), ['unknown', 'Σίτες', 2, 'τεμ.']);
});

test('προσωπικά στοιχεία: ΜΟΝΟ η λεκάνη, και ο τίτλος χωρίς όνομα/τηλέφωνο/περιοχή', () => {
  const r = parse('μπάνιο για τον κύριο Παπαδόπουλο στο 6912345678 στο Χαλάνδρι, λεκάνη');
  assert.deepEqual(r.lines.filter(l => !l.unknown || l.keep).map(l => l.id), ['wc']);
  assert.equal(r.title, 'μπάνιο');
  assert.doesNotMatch(JSON.stringify(r), /Παπαδόπουλ|6912345678|Χαλάνδρι|κύριο/, 'πουθενά στο αποτέλεσμα, ούτε στις γραμμές που πετιούνται');
  for(const t of ['για τον κ. Νικολάου, 2 ροπ', 'για την κυρία Μαρία, 2 ροπ', 'κ. Γιώργος, 2 ροπ', 'στο 210 1234567, 2 ροπ']){
    assert.deepEqual(kept(t).map(short), [['unknown', 'Ροπ', 2, 'τεμ.']], t);
    assert.doesNotMatch(JSON.stringify(parse(t)), /Νικολάου|Μαρία|Γιώργος|1234567/, t);
  }
});

test('τοποθεσίες, ώρες, ημερομηνίες, εργασία, γεμίσματα: ποτέ προϊόν', () => {
  for(const t of ['στο Χαλάνδρι', 'στη Γλυφάδα', 'στη Νέα Σμύρνη', 'αύριο το πρωί', 'στις 12 Νοεμβρίου', 'την Τρίτη στις 10', 'στις 10:30',
    'εργασία 300 ευρώ', 'θέλω', 'βάλε', 'χρειάζεται', 'επίσης', 'ε', 'λοιπόν', 'ένα', 'μία', 'θέλω και επίσης']){
    assert.deepEqual(kept(t), [], t);
  }
  assert.deepEqual(kept('στη Γλυφάδα, λεκάνη').map(l => l.id), ['wc']);
  assert.equal(parse('επισκευή κουζίνας στη Νέα Σμύρνη για τον Γιώργο').title, 'επισκευή κουζίνας');
});

test('«θέλω λεκάνη και επίσης σιφόνι» → 2 γραμμές, όχι «θέλω»/«επίσης»', () => {
  assert.deepEqual(kept('θέλω λεκάνη και επίσης σιφόνι').map(l => l.id), ['wc', 'siphon']);
});

test('scrub: βγάζει τηλέφωνα, πρόσωπα, τόπους· αφήνει τα υλικά', () => {
  assert.equal(scrub('μπάνιο για τον κύριο Παπαδόπουλο στο 6912345678 στο Χαλάνδρι'), 'μπάνιο');
  assert.equal(scrub('2 σίτες στο μπάνιο'), '2 σίτες στο μπάνιο', 'πεζό μετά το «στο» = όχι τόπος');
  assert.equal(scrub('τηλ 210 1234567'), 'τηλ');
  assert.equal(scrub('3 ροπ'), '3 ροπ');
});

// ── Stress (tests/stress/release.mjs): ευρήματα που διορθώθηκαν ──
test('«πλακάκι 30 επί» (ημιτελής διάσταση) δεν ρίχνει εξαίρεση και ζητάει ποσότητα', () => {
  for(const t of ['πλακάκι 30 επί', 'πλακάκι 30 x', '12 μέτρα σωλήνα και πλακάκι 30 επί', '30 επί', 'επί', 'x']){
    assert.doesNotThrow(() => parse(t), t);
  }
  assert.deepEqual([byId(parse('πλακάκι 30 επί'), 'tile')[0].qtyMissing, byId(parse('πλακάκι 30 επί'), 'tile')[0].qty], [true, 1]);
});

test('σύνθετος αριθμός σε λέξεις ΜΕΤΑ το υλικό: όλος (ήταν μόνο η πρώτη λέξη)', () => {
  assert.equal(byId(parse('αρμόστοκος είκοσι εννέα σακιά'), 'grout')[0].qty, 29);
  assert.equal(byId(parse('καλώδιο εκατόν πενήντα δύο μέτρα'), 'cable')[0].qty, 152);
  assert.equal(byId(parse('σοβάς είκοσι οκτώ τετραγωνικά'), 'plaster')[0].qty, 28);
});

test('«επίσης», «μετά», «ακόμα» με τόνους και «ΚΑΙ» με κεφαλαία χωρίζουν φράσεις', () => {
  assert.deepEqual(parse('ΔΥΟ ΛΕΚΑΝΕΣ ΚΑΙ ΕΡΓΑΣΙΑ 400 ΕΥΡΩ').labor, {cents: 40000});
  assert.deepEqual(parse('2 λεκάνες επίσης εργασία 400 ευρώ').labor, {cents: 40000});
  assert.deepEqual(parse('2 λεκάνες μετά 3 πρίζες').lines.map(l => [l.id, l.qty]), [['wc', 2], ['socket', 3]]);
});

test('«30επί60» κολλητά = διάσταση, όχι 30 τ.μ.', () => {
  const t = byId(parse('πλακάκι 80επί60, 145 τετραγωνικά'), 'tile')[0];
  assert.deepEqual([t.name, t.qty], ['Πλακάκι 80×60', 145]);
});
