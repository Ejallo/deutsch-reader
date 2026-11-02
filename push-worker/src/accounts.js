// Friends' accounts: «Sign in with Google» and per-user data storage in D1.
// The app sends its whole data blob (like the GitHub sync); bodies are gzipped to stay small.

const APP_URLS = {
  prod: 'https://ejallo.github.io/deutsch-reader/',
  dev: 'http://localhost:5173/deutsch-reader/',
};
const ALLOWED_ORIGINS = ['https://ejallo.github.io', 'http://localhost:5173'];
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

const b64urlDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function cors(req) {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

let certCache = { keys: null, until: 0 };

async function googleKeys() {
  if (certCache.keys && Date.now() < certCache.until) return certCache.keys;
  const r = await fetch(GOOGLE_CERTS);
  const maxAge = Number(r.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] ?? 3600);
  certCache = { keys: (await r.json()).keys, until: Date.now() + maxAge * 1000 };
  return certCache.keys;
}

/** Verifies a Google ID token (RS256) and returns its claims, or null. */
async function verifyGoogleToken(token, clientId) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  if (claims.aud !== clientId || !GOOGLE_ISSUERS.includes(claims.iss) || claims.exp * 1000 < Date.now()) return null;
  return claims;
}

const sha256 = async (s) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** Creates (or refreshes) the user and returns a new session token; only its hash is stored. */
async function startSession(env, claims) {
  const now = Date.now();
  await env.DB.prepare('INSERT INTO users (id, email, name, created) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET email = ?2, name = ?3')
    .bind(claims.sub, claims.email ?? '', claims.name ?? claims.given_name ?? '', now)
    .run();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created) VALUES (?1, ?2, ?3)').bind(await sha256(token), claims.sub, now).run();
  return token;
}

async function userFromRequest(req, env) {
  const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const row = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).first();
  return row?.user_id ?? null;
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Google posts the credential here after sign-in (redirect mode); we bounce back into the app with a session. */
async function googleRedirect(req, env, target) {
  const form = await req.formData();
  const claims = await verifyGoogleToken(String(form.get('credential') ?? ''), env.GOOGLE_CLIENT_ID);
  const back = new URL(APP_URLS[target]);
  if (!claims) {
    back.hash = 'login-error';
    return Response.redirect(back.toString(), 303);
  }
  const session = await startSession(env, claims);
  // The fragment never reaches any server; the app reads and clears it
  back.hash = new URLSearchParams({ login: session, name: claims.name ?? '', email: claims.email ?? '' }).toString();
  return Response.redirect(back.toString(), 303);
}

export async function handleAccount(req, env) {
  const path = new URL(req.url).pathname;
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });

  if (req.method === 'POST' && (path === '/auth/google/prod' || path === '/auth/google/dev')) {
    return googleRedirect(req, env, path.endsWith('dev') ? 'dev' : 'prod');
  }

  const userId = await userFromRequest(req, env);
  if (!userId) return json(req, { error: 'unauthorized' }, 401);

  if (path === '/auth/logout' && req.method === 'POST') {
    const token = req.headers.get('Authorization').slice(7);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
    return json(req, { ok: true });
  }

  if (path === '/data' && req.method === 'GET') {
    const row = await env.DB.prepare('SELECT body, version FROM data WHERE user_id = ?1').bind(userId).first();
    if (!row) return json(req, { data: null, version: 0 });
    return json(req, { data: JSON.parse(await gunzip(new Uint8Array(row.body))), version: row.version });
  }

  if (path === '/data' && req.method === 'PUT') {
    const { data, version } = await req.json();
    if (!data || typeof version !== 'number') return json(req, { error: 'bad body' }, 400);
    const body = await gzip(JSON.stringify(data));
    if (body.byteLength > 1900000) return json(req, { error: 'too large' }, 413);
    // Optimistic concurrency: only the holder of the latest version may write
    const res =
      version === 0
        ? await env.DB.prepare('INSERT INTO data (user_id, body, version, updated) VALUES (?1, ?2, 1, ?3) ON CONFLICT(user_id) DO NOTHING').bind(userId, body, Date.now()).run()
        : await env.DB.prepare('UPDATE data SET body = ?2, version = version + 1, updated = ?3 WHERE user_id = ?1 AND version = ?4').bind(userId, body, Date.now(), version).run();
    if (!res.meta.changes) return json(req, { error: 'conflict' }, 409);
    return json(req, { version: version + 1 });
  }

  return json(req, { error: 'not found' }, 404);
}
