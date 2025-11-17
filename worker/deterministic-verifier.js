// worker/deterministic-verifier.js
// Cloudflare Worker verifier with deterministic η/y derivation
// Server derives η from (IssuerPK, Origin, Epoch, Policy, Window)
// Server derives y from (enc(Z'), KID, AADr, η)
// Pluggable storage backends: KV (Community) or Durable Objects (Enterprise)

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import {
  canonicalOrigin,
  currentEpochDays,
  windowId,
  validWindowsWithSkew,
  deriveEta,
  deriveNullifierY,
  deriveIdempotencyKey,
  deriveGraceNullifier,
  isInGracePeriod,
  deriveTlsBinding,
  parsePolicyId,
  secondsUntilWindowEnd,
  bytesToB64url,
  b64urlToBytes,
  secretToBytes,
  H2,
  H3
} from './shared/crypto.js';
import { KVStore } from './adapters/kv-store.js';
import { DurableObjectStore } from './adapters/durable-object-store.js';
import { emitTelemetryEventAsync, createVerificationEvent } from './shared/telemetryEmitter.js';
import { lookupApiKey } from './shared/api-key-lookup.js';

const u8 = (s) => (typeof s === 'string' ? utf8ToBytes(s) : s);
const n = p256.CURVE.n;
const G = p256.ProjectivePoint.BASE;

const CONFIG = {
  LABEL_DLEQ: 'OPRF_METERING_DLEQ_v1',
  LABEL_HTTP_CTX: 'HTTP_CTX_v1',
  LABEL_TLS_EXPORTER: 'EXPORTER-Channel-Binding',  // RFC 5705
  PROTOCOL_VERSION: 'BRASS_v2.0',
  CIPHER_SUITE: 'P256_SHA256',
  STRICT_ENFORCEMENT: true,  // Can be configured via env
  DEFAULT_RATE_LIMIT: 10,    // Default requests per window
};

function modN(x) { let r = x % n; return r < 0n ? r + n : r; }
function bytesToBig(b) { 
  let hex = '';
  for (let i = 0; i < b.length; i++) {
    hex += b[i].toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
}

// Constant-time equality check
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let v = 0;
  for (let i = 0; i < a.length; i++) v |= a[i] ^ b[i];
  return v === 0;
}

function dleqVerify({ label, g1, h1, g2, h2, A1, A2, c, r, bind }) {
  const challenge = H3(
    `BRASS:${label}:`,
    g1.toRawBytes(true), 
    h1.toRawBytes(true),
    g2.toRawBytes(true), 
    h2.toRawBytes(true),
    A1.toRawBytes(true), 
    A2.toRawBytes(true), 
    bind
  );
  const chal = modN(bytesToBig(challenge));
  return chal === c;
}

/**
 * Decode and validate elliptic curve point with security checks
 * 
 * SECURITY CHECKS:
 * 1. Point on curve - fromHex() validates point is on P-256 curve
 * 2. Point at infinity - Explicitly reject ZERO point
 * 3. Non-canonical encoding - fromHex() rejects invalid encodings
 * 4. Low-order points - N/A for P-256 (prime-order curve, no low-order subgroup)
 * 
 * @noble/curves library performs cryptographic validation during fromHex()
 * and has been audited (6 security audits as of 2025)
 */
function decodePoint(b64) {
  const bytes = b64urlToBytes(b64);
  
  // Parse point and validate it's on the curve
  // This rejects: invalid encodings, off-curve points
  let P;
  try {
    P = p256.ProjectivePoint.fromHex(bytes);
  } catch (e) {
    throw new Error('invalid_point_encoding');
  }
  
  // Explicitly validate point properties
  P.assertValidity();
  
  // Reject point at infinity (ZERO)
  if (P.equals(p256.ProjectivePoint.ZERO)) {
    throw new Error('invalid_point_infinity');
  }
  
  return P;
}

// Removed computeDFromOverrideOrRequest - inline to avoid double body consumption

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    let origin = 'unknown';
    
    try {
      // Health endpoint
      if (request.method === 'GET') {
        const url = new URL(request.url);
        if (url.pathname === '/health') {
          return new Response(JSON.stringify({
            ok: true,
            ts: Date.now(),
            build: 'deterministic-verifier-v2.0',
            mode: env.STORAGE_BACKEND || 'kv',
            strictEnforcement: CONFIG.STRICT_ENFORCEMENT
          }), { headers: { 'content-type': 'application/json' } });
        }
      }
      
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      // API key authentication with KV-based lookup
      const auth = request.headers.get('authorization') || '';
      if (!auth.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'missing_api_key' }), { 
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }
      const apiKey = auth.slice(7);
      
      // SECURITY: Multi-tenant isolation via KV-based API key lookup
      // This maps API keys to projectId to prevent cross-tenant collisions
      let projectId, limit;
      
      if (env.BRASS_KV && !env.BRASS_USE_ENV_AUTH) {
        // Production: KV-based lookup (multi-tenant)
        const keyData = await lookupApiKey(apiKey, env.BRASS_KV);
        
        if (!keyData.valid) {
          return new Response(JSON.stringify({ error: keyData.error || 'invalid_api_key' }), { 
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }
        
        projectId = keyData.projectId;
        limit = keyData.limit || CONFIG.DEFAULT_RATE_LIMIT;
        
      } else {
        // Fallback: Simple env var auth (single-tenant/dev only)
        // TODO: Remove this path once all deployments use KV lookup
        if (apiKey !== env.BRASS_SECRET_KEY) {
          return new Response(JSON.stringify({ error: 'invalid_api_key' }), { 
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }
        projectId = env.BRASS_PROJECT_ID || 'default';
        limit = env.BRASS_RATE_LIMIT ? parseInt(env.BRASS_RATE_LIMIT, 10) : CONFIG.DEFAULT_RATE_LIMIT;
      }

      // Read body text once, then parse and hash separately
      const bodyText = await request.text();
      const payload = JSON.parse(bodyText);
      
      const {
        KID,
        AADr,
        origin: originRaw,
        epoch,
        c,
        Z,
        Zprime,
        P,
        M,
        piI,
        piC,
        d_client,
        tls_exporter_b64, // Optional: TLS exporter bytes for channel binding (RFC 5705/8446)
      } = payload;
      
      origin = originRaw; // Track for telemetry

      // Compute d (request binding)
      // Use pre-parsed payload and body text (avoid double consumption)
      const url = new URL(request.url);
      const d = payload.http_method && payload.http_path && payload.http_body_hash_b64
        ? H3(
            `BRASS:${CONFIG.LABEL_HTTP_CTX}:`,
            payload.http_method.toUpperCase(),
            payload.http_path,
            b64urlToBytes(payload.http_body_hash_b64)
          )
        : H3(
            `BRASS:${CONFIG.LABEL_HTTP_CTX}:`,
            request.method.toUpperCase(),
            url.pathname,
            sha256(utf8ToBytes(bodyText))
          );

      // Decode elliptic curve points
      const Ppt = decodePoint(P);
      const Mpt = decodePoint(M);
      const Zpt = decodePoint(Z);
      const Zppt = decodePoint(Zprime);

      // Verify issuer proof πI (DLEQ: Y is consistent)
      const Y = decodePoint(env.BRASS_ISSUER_PUBKEY);
      const cI = bytesToBig(b64urlToBytes(piI.c));
      const rI = bytesToBig(b64urlToBytes(piI.r));
      const A1 = G.multiply(rI).add(Y.multiply(cI));
      const A2 = Mpt.multiply(rI).add(Zpt.multiply(cI));
      const bindI = new Uint8Array(0);
      const okI = dleqVerify({ 
        label: CONFIG.LABEL_DLEQ, 
        g1: G, 
        h1: Y, 
        g2: Mpt, 
        h2: Zpt, 
        A1, 
        A2, 
        c: cI, 
        r: rI, 
        bind: bindI 
      });
      
      if (!okI) {
        emitTelemetry(env, ctx, origin, 'invalid_piI', startTime);
        return new Response(JSON.stringify({ error: 'invalid_piI' }), { 
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }

      // Verify d if client provided it
      if (d_client) {
        const dMatch = ctEqual(d, b64urlToBytes(d_client));
        if (!dMatch) {
          emitTelemetry(env, ctx, origin, 'd_mismatch', startTime);
          return new Response(JSON.stringify({ error: 'd_mismatch' }), { 
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }
      }

      // SERVER-SIDE DETERMINISTIC DERIVATION
      const originCanonical = canonicalOrigin(origin);
      const epochDays = currentEpochDays();
      const policyId = parsePolicyId(AADr);
      const window = windowId(epochDays);
      
      // Derive η deterministically
      const eta = deriveEta(
        env.BRASS_ISSUER_PUBKEY,
        originCanonical,
        epochDays,
        policyId,
        window
      );
      
      // Derive y deterministically
      const y = deriveNullifierY(
        Zprime,  // enc(Z') as base64url string
        KID,
        AADr,
        eta
      );

      // Verify client proof πC (DLEQ: client knows blinding factor)
      const cC = bytesToBig(b64urlToBytes(piC.c));
      const rC = bytesToBig(b64urlToBytes(piC.r));
      
      // CRITICAL: Bind ALL enforcement inputs to prevent downgrade/manipulation attacks
      // TLS channel binding: Use exporter bytes when available (RFC 5705/8446), else fallback
      const tlsExporterBytes = tls_exporter_b64 ? b64urlToBytes(tls_exporter_b64) : null;
      const tlsBinding = deriveTlsBinding(tlsExporterBytes);
      const serverWindow = u8(window);  // Server-derived, not from client AADr
      const suite = u8(CONFIG.CIPHER_SUITE);
      const version = u8(CONFIG.PROTOCOL_VERSION);
      
      const bindC = H3(
        'BIND',
        y,                    // Nullifier
        b64urlToBytes(c),     // Client nonce
        d,                    // Request context (method/path/body hash)
        tlsBinding,           // TLS channel binding (exporter bytes or fallback)
        serverWindow,         // Server-derived window (UTC day)
        suite,                // Cryptographic suite identifier
        version,              // Protocol version
        u8(policyId),         // Server-derived policy ID
        u8(AADr),             // Additional client-supplied data (non-security-critical)
        u8(KID),              // Key identifier
        eta                   // Server-derived salt
      );
      
      const A1c = Ppt.multiply(rC).add(Mpt.multiply(cC));
      const A2c = G;
      const okC = dleqVerify({ 
        label: CONFIG.LABEL_DLEQ, 
        g1: Ppt, 
        h1: Mpt, 
        g2: G, 
        h2: G, 
        A1: A1c, 
        A2: A2c, 
        c: cC, 
        r: rC, 
        bind: bindC 
      });
      
      if (!okC) {
        emitTelemetry(env, ctx, origin, 'invalid_piC', startTime);
        return new Response(JSON.stringify({ error: 'invalid_piC' }), { 
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }

      // Derive idempotency key
      const kvSecret = secretToBytes(env.BRASS_KV_SECRET);
      const IK = deriveIdempotencyKey(kvSecret, y, c);

      // Choose storage backend
      const storageBackend = env.STORAGE_BACKEND || 'kv';
      let store;
      
      if (storageBackend === 'durable_objects' && env.BRASS_COUNTER) {
        store = new DurableObjectStore(env.BRASS_COUNTER);
      } else {
        store = new KVStore(env.BRASS_KV);
      }

      // Get boundary grace configuration (default 60 seconds)
      // Note: limit is a number (rate limit), boundaryGraceSeconds comes from env or API key lookup
      const boundaryGraceSeconds = parseInt(env.BOUNDARY_GRACE_SECONDS || '60', 10);
      
      // GRACE-BRIDGE: Check if we're in grace period around UTC midnight
      const now = Date.now();
      const inGracePeriod = isInGracePeriod(now, boundaryGraceSeconds);
      let graceHit = false;
      
      if (inGracePeriod) {
        // Compute window-agnostic grace nullifier
        // W1.1: Include suite, version, AADr for proper domain separation
        const yGrace = deriveGraceNullifier(
          Zprime,  // Already base64url-encoded from JSON payload
          KID,
          env.BRASS_ISSUER_PUBKEY,
          originCanonical,
          policyId,
          CONFIG.CIPHER_SUITE,     // e.g., 'P256_SHA256'
          CONFIG.PROTOCOL_VERSION, // e.g., 'BRASS_v2.0'
          AADr                     // Request context (includes window, policy)
        );
        const graceKey = bytesToB64url(yGrace);
        
        // Check if grace key already cached
        const graceGuard = await store.guardGrace({
          projectId,
          graceKey,
          ttlSeconds: boundaryGraceSeconds
        });
        
        if (graceGuard.hit) {
          graceHit = true;
          const cachedResponse = graceGuard.response;
          
          // W1.2: ONLY replay successes during grace - re-evaluate denials
          // Rationale: Grace protects against double-spend on successful redemptions.
          // Denials (rate limits) should be re-checked in the current window.
          if (cachedResponse.ok) {
            // SUCCESS: Replay cached success response
            emitTelemetry(env, ctx, origin, 'boundary_grace_replay_success', startTime, {
              graceHit: true,
              cached: true,
              wasSuccess: true
            });
            
            // W1.3: Add windowUsed to grace responses
            return new Response(JSON.stringify({
              ...cachedResponse,
              grace: true,
              windowUsed: 'grace_cached'  // Indicates response from grace cache
            }), { 
              status: 200,
              headers: { 'content-type': 'application/json' }
            });
          } else {
            // DENIAL: Re-evaluate in current window (don't replay cached denial)
            // W1.2 CRITICAL: When a cached denial is found during grace period,
            // we do NOT return the cached 429 response. Instead, we fall through
            // to the normal verification flow below which will re-check limits.
            // We MUST set graceHit=false so the fresh result gets cached,
            // otherwise every request during grace hits the stale denial.
            emitTelemetry(env, ctx, origin, 'boundary_grace_reevaluate_denial', startTime, {
              graceHit: true,
              cached: true,
              wasSuccess: false,
              reevaluating: true
            });
            // Reset graceHit so fresh result gets cached (might be success now!)
            graceHit = false;
          }
        }
      }

      // Normal verification path (also handles denial re-evaluation from grace)
      // Attempt to spend token (limit already set from API key lookup)
      const ttlSeconds = secondsUntilWindowEnd(epochDays);
      
      // CRITICAL: Include projectId in key namespace to prevent cross-tenant collisions
      // Without this, two tenants sharing issuer material could collide in KV/DO counters
      const result = await store.spend({
        key: {
          projectId,            // SECURITY: Tenant isolation - prevent cross-customer collisions
          issuerPk: env.BRASS_ISSUER_PUBKEY,
          origin: originCanonical,
          epoch: epochDays,
          policy: policyId,
          window,
          y: bytesToB64url(y)
        },
        IK,
        limit,
        ttlSeconds
      });

      // Cache response in grace guard if in grace period
      // Note: Cache even if idempotent=true to ensure grace protection works
      if (inGracePeriod && !graceHit) {
        // W1.1: Include suite, version, AADr for proper domain separation
        const yGrace = deriveGraceNullifier(
          Zprime,  // Already base64url-encoded from JSON payload
          KID,
          env.BRASS_ISSUER_PUBKEY,
          originCanonical,
          policyId,
          CONFIG.CIPHER_SUITE,     // e.g., 'P256_SHA256'
          CONFIG.PROTOCOL_VERSION, // e.g., 'BRASS_v2.0'
          AADr                     // Request context (includes window, policy)
        );
        const graceKey = bytesToB64url(yGrace);
        
        // Cache response for grace period (fire-and-forget)
        // Skip only if we already got this from grace cache (graceHit=true)
        ctx.waitUntil(store.cacheGraceResponse({
          projectId,
          graceKey,
          ttlSeconds: boundaryGraceSeconds,
          response: result
        }));
      }
      
      if (!result.ok) {
        // BOUNDARY METRIC: Emit metric if denied during grace period
        const eventType = inGracePeriod ? 'boundary_denied' : (result.error || 'rate_limited');
        emitTelemetry(env, ctx, origin, eventType, startTime, {
          inGracePeriod
        });
        
        // W1.3: Add windowUsed to all responses
        return new Response(JSON.stringify({ 
          error: result.error,
          remaining: result.remaining || 0,
          windowUsed: window  // Current window (epoch days)
        }), { 
          status: 429,
          headers: { 'content-type': 'application/json' }
        });
      }

      // Success - emit telemetry
      // BOUNDARY METRIC: Track if this was a grace-protected success
      emitTelemetry(env, ctx, origin, 'success', startTime, {
        idempotent: result.idempotent || false,
        remaining: result.remaining,
        inGracePeriod,
        graceProtected: inGracePeriod
      });
      
      // W1.3: Add windowUsed and normalized remaining to success responses
      return new Response(JSON.stringify({ 
        ok: true, 
        remaining: result.remaining,      // Already normalized to current window by store
        idempotent: result.idempotent || false,
        windowUsed: window                // Current window (epoch days)
      }), { 
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    } catch (e) {
      console.error('Verifier error:', e);
      emitTelemetry(env, ctx, origin, e.message || 'server_error', startTime);
      return new Response(JSON.stringify({ 
        error: e.message || 'server_error' 
      }), { 
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }
  },
};

// Helper function to emit telemetry events asynchronously
function emitTelemetry(env, ctx, origin, result, startTime, metadata = {}) {
  // Only emit if telemetry URL is configured
  if (!env.TELEMETRY_INGESTION_URL || !env.TELEMETRY_API_KEY) {
    return;
  }
  
  const responseTimeMs = Date.now() - startTime;
  
  // Create verification event (projectId/apiKeyId optional until worker has metadata)
  const event = {
    projectId: env.TELEMETRY_PROJECT_ID || 'unknown',
    apiKeyId: env.TELEMETRY_API_KEY_ID || 'unknown',
    origin: origin || 'unknown',
    eventType: 'verify_request',
    result,
    responseTimeMs,
    metadata
  };
  
  // Emit asynchronously (fire-and-forget with waitUntil)
  emitTelemetryEventAsync(
    env.TELEMETRY_INGESTION_URL,
    env.TELEMETRY_API_KEY,
    event,
    ctx
  );
}

// Export Durable Object class for Enterprise tier
export { BrassCounterDO } from './adapters/durable-object-store.js';
