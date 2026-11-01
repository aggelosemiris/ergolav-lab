// Αυστηρή ανάγνωση αριθμών όπως τους γράφει ο χρήστης (ελληνική γραφή: 1.234,50).
// Κανόνας: ποτέ σιωπηλά λάθος τιμή — ό,τι είναι αμφίσημο ή άκυρο επιστρέφει {error}, όχι αριθμό.

const count = (s, ch) => s.split(ch).length - 1;
const valid = (s, maxDecimals, allowZero) => parseAmount(s, {maxDecimals, allowZero}).value !== undefined;

/**
 * @returns {{value:number}|{error:string}}
 *  Ελληνική γραφή: υποδιαστολή = κόμμα, χιλιάδες = τελεία (σε ομάδες των 3).
 *  «1.234,50» → 1234.5 · «1234,50» → 1234.5 · «1.234.567» → 1234567 · « 7 » → 7 (κενά μόνο στις άκρες)
 *  ΜΠΛΟΚ: «1.500» (1500 ή 1,5;) · «1.5» (τελεία ως υποδιαστολή) · «1 234» (κενό ως διαχωριστικό) ·
 *         «12,345» με maxDecimals 2 · «-3» · «12a»
 *  Απόφαση για «1.500» (μία τελεία + 3 ψηφία): ΜΠΛΟΚ. Αλλαγή πολιτικής = ενημέρωση ΠΡΩΤΑ του
 *  test/holdout-number.test.js (ανεξάρτητο oracle της QA).
 */
export function parseAmount(input, {maxDecimals = 2, allowZero = false} = {}){
  // Μόνο κενά στις άκρες και προαιρετικό «€» στο τέλος· κενό ΜΕΣΑ στον αριθμό = μπλοκ.
  const s = String(input ?? '').replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]*€$/, '');
  if(!s) return {error: 'Γράψε έναν αριθμό.'};
  if(/\s/.test(s)) return {error: `«${input}»: μην χωρίζεις τα ψηφία με κενό — γράψε π.χ. 1234 ή 1.234,00.`};
  if(!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return {error: `«${input}» δεν είναι αριθμός.`};

  let intPart, decPart = '';
  const dots = count(s, '.'), commas = count(s, ',');
  if(commas){
    // Υποδιαστολή μόνο το κόμμα (και μόνο ένα)· πριν από αυτό, χιλιάδες μόνο με τελείες σε ομάδες των 3.
    if(commas > 1) return {error: `«${input}»: περισσότερα από ένα κόμματα — γράψε π.χ. 1.234,50.`};
    if(s.lastIndexOf('.') > s.lastIndexOf(',')) return {error: `«${input}»: στα ελληνικά η υποδιαστολή είναι κόμμα — γράψε π.χ. 1.234,56.`};
    [intPart, decPart] = s.split(',');
    if(dots){
      if(!/^\d{1,3}(\.\d{3})+$/.test(intPart)) return {error: `«${input}»: λάθος διαχωρισμός χιλιάδων.`};
      intPart = intPart.split('.').join('');
    }
  } else if(dots){
    if(dots > 1 && /^\d{1,3}(\.\d{3})+$/.test(s)) intPart = s.split('.').join('');   // 1.234.567: σίγουρα χιλιάδες
    else if(/^\d{1,3}\.\d{3}$/.test(s)){
      // «1.500»: 1500 ή 1,5; — δεν μαντεύουμε.
      const asDec = s.replace('.', ',').replace(/0+$/, '').replace(/,$/, '');
      const opts = [s.replace('.', ''), asDec].filter(o => !/^0\d/.test(o) && valid(o, maxDecimals, allowZero));
      return {error: `«${input}»: ασαφές — ` + (opts.length ? `γράψε ${opts.join(' ή ')}.` : 'γράψε τον αριθμό χωρίς τελεία.')};
    }
    else {
      // Προτείνουμε διόρθωση μόνο αν περνά η ίδια από τον parser (π.χ. «1.234.56» → όχι «1,234,56»).
      const fix = s.replace(/\./g, ',');
      return {error: dots === 1 && valid(fix, maxDecimals, allowZero)
        ? `«${input}»: στα ελληνικά η υποδιαστολή είναι κόμμα — γράψε ${fix}.`
        : `«${input}»: λάθος διαχωρισμός — γράψε π.χ. 1.234,56.`};
    }
  } else intPart = s;

  if(decPart.length > maxDecimals) return {error: `«${input}»: έως ${maxDecimals} δεκαδικά.`};
  const value = Number(intPart + (decPart ? '.' + decPart : ''));
  if(!Number.isFinite(value)) return {error: `«${input}» δεν είναι αριθμός.`};
  if(value <= 0 && !allowZero) return {error: 'Πρέπει να είναι μεγαλύτερο από 0.'};
  return {value};
}

export const toCents = v => Math.round(v * 100);
export const formatEur = v => v.toLocaleString('el-GR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';
export const formatQty = v => v.toLocaleString('el-GR', {maximumFractionDigits: 3});
