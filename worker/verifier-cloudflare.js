// worker/strict-verifier.js - Cloudflare Workers compatible
// Verifier with Durable Object counter (single-writer).
// Verifies issuer πI (cacheable) and client πC bound to (c, d, η).

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

const u8 = (s) => (typeof s === 'string' ? utf8ToBytes(s) : s);

// Cloudflare Workers compatible base64url decode
const b64ud = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  return new Uint8Array(Array.from(binary, c => c.charCodeAt(0)));
};

// Cloudflare Workers compatible base64url encode
const b64u = (u) => {
  const binary = Array.from(u, b => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const n = p256.CURVE.n;
const G = p256.ProjectivePoint.BASE;

const CONFIG = {
  LABEL_DLEQ: 'OPRF_METERING_DLEQ_v1',
  LABEL_Y: 'OPRF_METERING_Y_v1',
  LABEL_HTTP_CTX: 'HTTP_CTX_v1',
  EXPORTER_LABEL: 'EXPORTER-OPRF-METERING-v1',
  REPLAY_TTL_SEC: 120,
  WINDOW_SEC: 60,
  STRICT: true,
};

const H = (...parts) => sha256(parts.reduce((acc, p) => new Uint8Array([...acc, ...u8(p)]), new Uint8Array()));
const Hlabel = (label, ...parts) => sha256(parts.reduce((acc, p) => new Uint8Array([...acc, ...u8(p)]), u8(`BRASS:${label}:`)));

function modN(x) { let r = x % n; return r < 0n ? r + n : r; }

// Cloudflare Workers compatible bytesToBig
function bytesToBig(b) {
  let hex = '';
  for (let i = 0; i < b.length; i++) {
    hex += b[i].toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
}

// Constant-time equality check to prevent timing attacks
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let v = 0;
  for (let i = 0; i < a.length; i++) v |= a[i] ^ b[i];
  return v === 0;
}

const fromB64url = b64ud; // Alias for clarity

function dleqVerify({ label, g1, h1, g2, h2, A1, A2, c, r, bind }) {
  const chal = modN(bytesToBig(H(u8(`BRASS:${label}:`),
    g1.toRawBytes(true), h1.toRawBytes(true),
    g2.toRawBytes(true), h2.toRawBytes(true),
    A1.toRawBytes(true), A2.toRawBytes(true), bind
  )));
  return chal === c;
}

function decodePoint(b64) {
  const bytes = b64ud(b64);
  const P = p256.ProjectivePoint.fromHex(bytes);
  if (P.equals(p256.ProjectivePoint.ZERO)) throw new Error('invalid_point_infinity');
  return P;
}

async function computeDFromOverrideOrRequest(payload, request) {
  const LABEL_HTTP_CTX = CONFIG.LABEL_HTTP_CTX;
  
  // If server-supplied http context is provided, use it (server-authoritative)
  if (payload?.http_method && payload?.http_path && payload?.http_body_hash_b64) {
    return Hlabel(LABEL_HTTP_CTX,
      payload.http_method.toUpperCase(),
      payload.http_path,
      fromB64url(payload.http_body_hash_b64)
    );
  }
  
  // Fallback: compute from this request (only valid when verifier is inline)
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;
  const body = method === 'GET' ? new Uint8Array(0) : new Uint8Array(await request.arrayBuffer());
  const bodyHash = sha256(body);
  return Hlabel(LABEL_HTTP_CTX, method, path, bodyHash);
}

export default {
  async fetch(request, env, ctx) {
    try {
      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
      };

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Health endpoint
      if (request.method === 'GET') {
        const url = new URL(request.url);
        if (url.pathname === '/health') {
          return new Response(JSON.stringify({
            ok: true,
            ts: Date.now(),
            build: 'strict-verifier-v1.2-cloudflare',
            kid: 'kid-rotate-2025-10'
          }), { headers: corsHeaders });
        }
      }
      
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }

      const auth = request.headers.get('authorization') || '';
      if (!auth.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401, headers: corsHeaders });
      }
      
      const apiKey = auth.slice(7);
      if (apiKey !== env.BRASS_SECRET_KEY) {
        return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 401, headers: corsHeaders });
      }

      const requestClone = request.clone();
      const payload = await request.json();
      const {
        KID, AADr, origin, epoch,
        y, eta, c, Z, Zprime, P, M, piI, piC, d_client,
      } = payload;

      const d = await computeDFromOverrideOrRequest(payload, requestClone);

      const Ppt = decodePoint(P);
      const Mpt = decodePoint(M);
      const Zpt = decodePoint(Z);
      const Zppt = decodePoint(Zprime);

      const Y = decodePoint(env.BRASS_ISSUER_PUBKEY);
      const cI = bytesToBig(b64ud(piI.c));
      const rI = bytesToBig(b64ud(piI.r));
      const A1 = G.multiply(rI).add(Y.multiply(cI));
      const A2 = Mpt.multiply(rI).add(Zpt.multiply(cI));
      const bindI = new Uint8Array(0);
      const okI = dleqVerify({ label: CONFIG.LABEL_DLEQ, g1: G, h1: Y, g2: Mpt, h2: Zpt, A1, A2, c: cI, r: rI, bind: bindI });
      if (!okI) {
        return new Response(JSON.stringify({ error: 'invalid_piI' }), { status: 401, headers: corsHeaders });
      }

      if (d_client) {
        const dMatch = ctEqual(d, b64ud(d_client));
        if (!dMatch) {
          return new Response(JSON.stringify({ error: 'd_mismatch' }), { status: 401, headers: corsHeaders });
        }
      }

      const cC = bytesToBig(b64ud(piC.c));
      const rC = bytesToBig(b64ud(piC.r));
      const bindC = H('BIND', b64ud(y), b64ud(c), d, u8(AADr), u8(KID), b64ud(eta));

      const A1c = Ppt.multiply(rC).add(Mpt.multiply(cC));
      const A2c = G;
      const okC = dleqVerify({ label: CONFIG.LABEL_DLEQ, g1: Ppt, h1: Mpt, g2: G, h2: G, A1: A1c, A2: A2c, c: cC, r: rC, bind: bindC });
      if (!okC) {
        return new Response(JSON.stringify({ error: 'invalid_piC' }), { status: 401, headers: corsHeaders });
      }

      const ySrv = Hlabel(CONFIG.LABEL_Y, b64ud(Zprime), KID, AADr, b64ud(eta));
      const yEq = ctEqual(b64ud(y), ySrv);
      if (!yEq) {
        return new Response(JSON.stringify({ error: 'y_mismatch' }), { status: 401, headers: corsHeaders });
      }

      const idempotencyIK = b64u(H('IK', b64ud(y), b64ud(c)));
      const windowSec = CONFIG.WINDOW_SEC;
      const now = Math.floor(Date.now() / 1000);
      const windowKey = Math.floor(now / windowSec) * windowSec;

      const originID = origin;
      const policyID = (AADr.split('|').find((x) => x.startsWith('policy=')) || 'policy=').split('=')[1] || 'default';
      const counterId = `${originID}|${policyID}|${windowKey}`;

      let accept = false;
      let remaining = 0;

      if (env.COUNTER) {
        const id = env.COUNTER.idFromName(counterId);
        const stub = env.COUNTER.get(id);
        const resp = await stub.fetch('https://counter/increment', {
          method: 'POST',
          body: JSON.stringify({ ik: idempotencyIK, y }),
        });
        const { ok, count, limit } = await resp.json();
        accept = ok;
        remaining = Math.max(0, (limit ?? 10) - count);
      } else {
        const replayKey = `replay:${counterId}:${idempotencyIK}`;
        const exists = await env.KV.get(replayKey);
        if (exists) {
          return new Response(JSON.stringify({ error: 'replay_detected' }), { status: 429, headers: corsHeaders });
        }
        await env.KV.put(replayKey, '1', { expirationTtl: CONFIG.REPLAY_TTL_SEC });

        const countKey = `count:${counterId}`;
        const cur = parseInt((await env.KV.get(countKey)) || '0', 10);
        const limit = 10;
        if (cur + 1 > limit) {
          return new Response(JSON.stringify({ error: 'limit_exceeded', remaining: 0 }), { status: 429, headers: corsHeaders });
        }
        await env.KV.put(countKey, String(cur + 1), { expirationTtl: windowSec + 5 });
        accept = true;
        remaining = limit - (cur + 1);
      }

      if (!accept) {
        return new Response(JSON.stringify({ error: 'limit_exceeded', remaining: 0 }), { status: 429, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ ok: true, remaining }), { status: 200, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'server_error', stack: e.stack }), { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }
  },
};

export class COUNTER {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.limit = 10;
  }
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname !== '/increment') return new Response('Not Found', { status: 404 });
    const { ik } = await req.json();
    const existed = await this.state.storage.get(ik);
    if (existed) return new Response(JSON.stringify({ ok: true, count: await this.state.storage.get('c') || 0, limit: this.limit }));
    await this.state.storage.put(ik, 1, { expiration: Date.now() + 1000 * 60 * 2 });
    const cur = (await this.state.storage.get('c')) || 0;
    const next = cur + 1;
    if (next > this.limit) return new Response(JSON.stringify({ ok: false, count: cur, limit: this.limit }), { status: 200 });
    await this.state.storage.put('c', next, { expiration: Date.now() + 1000 * 65 });
    return new Response(JSON.stringify({ ok: true, count: next, limit: this.limit }), { status: 200 });
  }
}
