export function percentile(values, p){
  if(!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1));
  return s[i];
}

export function latencySummary(values){
  if(!values.length) return {count: 0, avg: null, median: null, p95: null, p99: null, min: null, max: null};
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: sum / values.length,
    median: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export const round = (x, d = 0) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;
export const pct = (a, b) => b ? round(100 * a / b, 1) : null;

/** Ντετερμινιστικός γεννήτορας τυχαίων (ίδια αποτελέσματα σε κάθε run). */
export function rng(seed = 42){
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Log-normal καθυστέρηση γύρω από median (ρεαλιστικότερη από σταθερή/ομοιόμορφη). */
export const lognormal = (rand, median, sigma = 0.35) => {
  const u = Math.max(1e-9, rand()), v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * z);
};
