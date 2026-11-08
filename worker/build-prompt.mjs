// Γράφει το worker/src/prompt-text.js από το κομμάτι «System» των prompts/rewrite.md και prompts/analysis.md.
// Ο worker δεν διαβάζει αρχεία την ώρα που τρέχει, γι' αυτό τα κείμενα μπαίνουν σε module. Τρέξ' το μετά από κάθε
// αλλαγή στους prompts· το test/worker.test.js αποτυγχάνει αν το module δεν συμφωνεί με τα .md.
//
// Χρήση:  node worker/build-prompt.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(root, 'worker/src/prompt-text.js');
const system = file => fs.readFileSync(path.join(root, file), 'utf8').split(/^## System\s*$/m)[1].split(/^---\s*$/m)[0].trim();

export function promptModule(){
  return [
    '// Παράγεται από το worker/build-prompt.mjs από τα prompts/rewrite.md και prompts/analysis.md· μην το αλλάζεις με το χέρι.',
    `export const REWRITE_SYSTEM = ${JSON.stringify(system('prompts/rewrite.md'))};`,
    `export const ANALYSIS_RULES = ${JSON.stringify(system('prompts/analysis.md'))};`,
    '',
  ].join('\n');
}

if(import.meta.url === pathToFileURL(process.argv[1] || '').href){
  fs.writeFileSync(OUT, promptModule());
  console.log(path.relative(root, OUT));
}
