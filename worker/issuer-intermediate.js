import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

const G = p256.ProjectivePoint.BASE;
const n = p256.CURVE.n;
const b64u = (u) => Buffer.from(u).toString('base64url');
const b64ud = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const u8 = (x) => (typeof x === 'string' ? utf8ToBytes(x) : x);
const H = (...parts) => sha256(parts.reduce((acc, p) => new Uint8Array([...acc, ...u8(p)]), new Uint8Array()));
const bytesToBig = (b) => BigInt('0x' + Buffer.from(b).toString('hex'));
const big32 = (x) => { let h = x.toString(16); if (h.length & 1) h = '0'+h; const buf = Buffer.from(h, 'hex'); const out = new Uint8Array(32); out.set(buf, 32-buf.length); return out; };
const modN = (x) => { let r = x % n; return r < 0n ? r + n : r; };

function chal_piI(Gpt, Y, M, Z, A1, A2, label='OPRF_METERING_DLEQ_v1') {
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
      // GET endpoints
      if (request.method === 'GET') {
        const url = new URL(request.url);
        
        // Health endpoint
        if (url.pathname === '/health') {
          return new Response(JSON.stringify({
            ok: true,
            ts: Date.now(),
            build: 'issuer-intermediate-v2.0',
            configured: !!env.ISSUER_K_HEX
          }), { headers: { 'content-type': 'application/json' } });
        }
        
        // Public key endpoint
        if (url.pathname === '/pub') {
          const kHex = env.ISSUER_K_HEX;
          if (!kHex) return new Response(JSON.stringify({ error: 'unconfigured' }), { status: 500 });
          const k = BigInt('0x' + kHex);
          const Y = G.multiply(k);
          return new Response(JSON.stringify({
            KID: 'kid-rotate-2025-10',
            Y: b64u(Y.toRawBytes(true))
          }), { headers: { 'content-type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }
      
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const { mode, KID, AADi, P, M } = await request.json();
      if (!P || !M) return new Response(JSON.stringify({ error: 'missing_P_or_M' }), { status: 400 });

      const kHex = env.ISSUER_K_HEX;
      if (!kHex) return new Response(JSON.stringify({ error: 'issuer_unconfigured' }), { status: 500 });
      const k = BigInt('0x' + kHex);

      const Ppt = p256.ProjectivePoint.fromHex(b64ud(P));
      const Mpt = p256.ProjectivePoint.fromHex(b64ud(M));

      const Y = G.multiply(k);
      const Z = Mpt.multiply(k);

      let alpha = modN(BigInt('0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')));
      if (alpha === 0n) alpha = 1n;
      const A1 = G.multiply(alpha);
      const A2 = Mpt.multiply(alpha);
      const cI = chal_piI(G, Y, Mpt, Z, A1, A2);
      const rI = modN(alpha - cI * k);

      return new Response(JSON.stringify({
        KID,
        Z: b64u(Z.toRawBytes(true)),
        piI: { c: b64u(big32(cI)), r: b64u(big32(rI)) }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'server_error' }), { status: 500 });
    }
  }
}
