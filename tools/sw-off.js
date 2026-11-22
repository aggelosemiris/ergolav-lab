// ergolav-sw: off
// ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ του service worker, αν κάτι πάει στραβά (βλ. docs/offline.md → «Απενεργοποίηση»):
//   cp tools/sw-off.js sw.js   και   SW_ENABLED = false στο src/offline.js   →   commit, deploy.
// Κάθε κινητό που έχει τον παλιό service worker κατεβάζει αυτόν (ο browser ελέγχει το sw.js σε κάθε άνοιγμα): σβήνει
// ΜΟΝΟ τις caches «ergolav-<scope>-» αυτού του scope, απεγγράφεται και ξαναφορτώνει τις ανοιχτές σελίδες από το δίκτυο.
// Τα δεδομένα της εφαρμογής (προσφορές, προφίλ, συνεδρία στο localStorage) ΔΕΝ αγγίζονται.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const prefix = `ergolav-${new URL(self.registration.scope).pathname}-`;
  for(const name of await caches.keys()) if(name.startsWith(prefix)) await caches.delete(name);
  await self.registration.unregister();
  for(const client of await self.clients.matchAll({type: 'window'})) client.navigate(client.url);
})()));
