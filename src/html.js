// Escape για κείμενο που μπαίνει σε HTML (innerHTML, PDF). ΜΙΑ συνάρτηση για όλη την εφαρμογή: κάνει escape και το
// μονό εισαγωγικό, ώστε να είναι ασφαλής και μέσα σε attribute με '…'. Το test/html.test.js απαγορεύει άλλον ορισμό.
const MAP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => MAP[c]);
