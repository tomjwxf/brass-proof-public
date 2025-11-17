import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

const G = p256.ProjectivePoint.BASE;
const n = p256.CURVE.n;

// Cloudflare Workers compatible helpers (no Buffer)
const b64u = (u) => {
  const binary = Array.from(u, b => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const b64ud = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  return new Uint8Array(Array.from(binary, c => c.charCodeAt(0)));
};

const u8 = (x) => (typeof x === 'string' ? utf8ToBytes(x) : x);

const H = (...parts) => sha256(parts.reduce((acc, p) => new Uint8Array([...acc, ...u8(p)]), new Uint8Array()));

const bytesToBig = (b) => {
  let hex = '';
  for (let i = 0; i < b.length; i++) {
    hex += b[i].toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
};

const big32 = (x) => {
  let h = x.toString(16);
  if (h.length & 1) h = '0' + h;
  const bytes = [];
  for (let i = 0; i < h.length; i += 2) {
    bytes.push(parseInt(h.substr(i, 2), 16));
  }
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
};

const modN = (x) => {
  let r = x % n;
  return r < 0n ? r + n : r;
};

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

function chal_piI(Gpt, Y, M, Z, A1, A2, label = 'OPRF_METERING_DLEQ_v1') {
  return modN(bytesToBig(H(
    `BRASS:${label}:`,
    Gpt.toRawBytes(true),
    Y.toRawBytes(true),
    M.toRawBytes(true),
    Z.toRawBytes(true),
    A1.toRawBytes(true),
    A2.toRawBytes(true)
  )));
}

export default {
  async fetch(request, env, ctx) {
    try {
      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      };

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // GET /pub endpoint to expose public key Y
      if (request.method === 'GET') {
        const url = new URL(request.url);
        if (url.pathname === '/pub') {
          const kHex = env.ISSUER_K_HEX;
          if (!kHex) return new Response(JSON.stringify({ error: 'unconfigured' }), { status: 500, headers: corsHeaders });
          const k = BigInt('0x' + kHex);
          const Y = G.multiply(k);
          return new Response(JSON.stringify({
            KID: 'kid-rotate-2025-10',
            Y: b64u(Y.toRawBytes(true))
          }), { headers: corsHeaders });
        }
        return new Response('Not Found', { status: 404, headers: corsHeaders });
      }

      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }

      const { mode, KID, AADi, P, M } = await request.json();
      if (!P || !M) {
        return new Response(JSON.stringify({ error: 'missing_P_or_M' }), { status: 400, headers: corsHeaders });
      }

      const kHex = env.ISSUER_K_HEX;
      if (!kHex) {
        return new Response(JSON.stringify({ error: 'issuer_unconfigured' }), { status: 500, headers: corsHeaders });
      }
      const k = BigInt('0x' + kHex);

      const Ppt = p256.ProjectivePoint.fromHex(b64ud(P));
      const Mpt = p256.ProjectivePoint.fromHex(b64ud(M));

      const Y = G.multiply(k);
      const Z = Mpt.multiply(k);

      let alpha = modN(bytesToBig(randomBytes(32)));
      if (alpha === 0n) alpha = 1n;
      const A1 = G.multiply(alpha);
      const A2 = Mpt.multiply(alpha);
      const cI = chal_piI(G, Y, Mpt, Z, A1, A2);
      const rI = modN(alpha - cI * k);

      return new Response(JSON.stringify({
        KID,
        Z: b64u(Z.toRawBytes(true)),
        piI: { c: b64u(big32(cI)), r: b64u(big32(rI)) }
      }), { status: 200, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'server_error' }), { 
        status: 500, 
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });
    }
  }
}
