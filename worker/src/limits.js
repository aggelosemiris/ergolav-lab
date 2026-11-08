// Όριο αιτημάτων με σταθερό παράθυρο (π.χ. 30 την ώρα ανά συσκευή). Καθαρή συνάρτηση, ώστε να ελέγχεται με τεστ·
// την καλεί το Durable Object RateLimiter (index.js), που κρατά την κατάσταση ανά κλειδί.

/** state: {start, n} ή undefined. Επιστρέφει {state, ok, retryAfter (δευτ.)}. */
export function windowHit(state, now, limit, windowMs){
  const s = state && now - state.start < windowMs ? state : {start: now, n: 0};
  if(s.n >= limit) return {state: s, ok: false, retryAfter: Math.max(1, Math.ceil((s.start + windowMs - now) / 1000))};
  return {state: {start: s.start, n: s.n + 1}, ok: true, retryAfter: 0};
}

export const HOUR = 3600_000, DAY = 24 * HOUR;

/** Τα όρια από τις ρυθμίσεις του worker (wrangler.toml [vars]): [κλειδί, όριο, παράθυρο]. */
export const limitsFor = (env, {device, ip}) => [
  [`device:${device}`, Number(env.RATE_DEVICE_PER_HOUR) || 30, HOUR],
  [`ip:${ip}`, Number(env.RATE_IP_PER_HOUR) || 60, HOUR],
  ['global', Number(env.RATE_GLOBAL_PER_DAY) || 300, DAY],
];
