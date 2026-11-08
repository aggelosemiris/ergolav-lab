// Cloudflare Worker της υπηρεσίας «Άλλαξέ το»: POST /rewrite-section (βλ. worker/README.md).
// Το κλειδί του AI είναι secret του worker (wrangler secret put ANTHROPIC_API_KEY): δεν υπάρχει στο repo, στην
// εφαρμογή ή στον browser. Η λογική είναι στο handler.js· εδώ μόνο το SDK και το όριο αιτημάτων.
import Anthropic from '@anthropic-ai/sdk';
import { DurableObject } from 'cloudflare:workers';
import { handle } from './handler.js';
import { windowHit, limitsFor } from './limits.js';

// Ένα Durable Object ανά κλειδί (συσκευή, IP, συνολικά) κρατά πόσα αιτήματα έγιναν στο τρέχον παράθυρο.
export class RateLimiter extends DurableObject {
  async hit(limit, windowMs){
    const r = windowHit(await this.ctx.storage.get('window'), Date.now(), limit, windowMs);
    if(r.ok) await this.ctx.storage.put('window', r.state);
    return {ok: r.ok, retryAfter: r.retryAfter};
  }
}

// Η IP δεν κρατιέται ως έχει: μόνο το hash της ορίζει το Durable Object.
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request, env){
    const client = new Anthropic({apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1});
    return handle(request, {
      env,
      createMessage: (params, options) => client.beta.messages.create(params, options),
      async limit({device, ip}){
        for(const [key, max, windowMs] of limitsFor(env, {device, ip: await sha256(`ergolav:${ip}`)})){
          const r = await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key)).hit(max, windowMs);
          if(!r.ok) return {ok: false, retryAfter: r.retryAfter, scope: key.split(':')[0]};
        }
        return {ok: true};
      },
    });
  },
};
