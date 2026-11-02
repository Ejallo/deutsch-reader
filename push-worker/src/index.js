// Deutsch Reader reminders: stores push subscriptions and, once an hour, nudges devices
// whose owner hasn't met today's goal by their chosen hour.
// Pushes carry no payload (no encryption needed); the app's service worker writes the text.

const ALLOWED_ORIGINS = ['https://ejallo.github.io', 'http://localhost:5173'];
const CONTACT = 'https://ejallo.github.io/deutsch-reader/';

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

function cors(req) {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

/** VAPID JWT (ES256) proving the push comes from this server. */
async function vapidAuth(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64urlText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64urlText(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function sendPush(sub, env) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, env), TTL: '43200', Urgency: 'normal', 'Content-Length': '0' },
  });
  return r.status;
}

/** Local date (YYYY-MM-DD) and hour in the device's time zone. */
function localNow(tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(id);

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (req.method !== 'POST') return json(req, { ok: true, service: 'deutsch-reader-push' });
    const path = new URL(req.url).pathname;
    let body;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: 'bad json' }, 400);
    }
    if (!validId(body.id)) return json(req, { error: 'bad id' }, 400);
    const key = `sub:${body.id}`;
    const current = JSON.parse((await env.SUBS.get(key)) ?? 'null');

    if (path === '/subscribe') {
      const s = body.subscription;
      if (!s?.endpoint?.startsWith('https://')) return json(req, { error: 'bad subscription' }, 400);
      const hour = Math.min(23, Math.max(0, Number(body.hour) || 20));
      await env.SUBS.put(key, JSON.stringify({ ...current, subscription: { endpoint: s.endpoint }, hour, tz: String(body.tz || 'Europe/Warsaw'), lastGoalDay: body.lastGoalDay ?? current?.lastGoalDay ?? '' }));
      return json(req, { ok: true });
    }
    if (path === '/state') {
      if (current) await env.SUBS.put(key, JSON.stringify({ ...current, lastGoalDay: String(body.lastGoalDay ?? '') }));
      return json(req, { ok: true });
    }
    if (path === '/unsubscribe') {
      await env.SUBS.delete(key);
      return json(req, { ok: true });
    }
    if (path === '/test') {
      if (!current) return json(req, { error: 'not subscribed' }, 404);
      return json(req, { ok: true, status: await sendPush(current.subscription, env) });
    }
    return json(req, { error: 'not found' }, 404);
  },

  async scheduled(_event, env) {
    let cursor;
    do {
      const page = await env.SUBS.list({ prefix: 'sub:', cursor });
      for (const { name } of page.keys) {
        const rec = JSON.parse((await env.SUBS.get(name)) ?? 'null');
        if (!rec?.subscription) continue;
        const { day, hour } = localNow(rec.tz);
        if (hour !== rec.hour || rec.lastGoalDay === day || rec.lastSentDay === day) continue;
        const status = await sendPush(rec.subscription, env);
        // Gone subscriptions (app removed, permission revoked) are cleaned up
        if (status === 404 || status === 410) await env.SUBS.delete(name);
        else await env.SUBS.put(name, JSON.stringify({ ...rec, lastSentDay: day }));
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  },
};
