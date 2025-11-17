# BRASS Cloudflare Workers

This directory contains the Cloudflare Workers implementation for BRASS privacy-preserving rate limiting with pluggable storage backends.

## Files

### Verifiers
- **deterministic-verifier.js** ⭐ **NEW** - Server-derived η/y with pluggable storage (KV or Durable Objects)
- **strict-verifier.js** - Legacy verifier (client-supplied η/y)

### Issuers  
- **issuer-intermediate.js** - Issuer worker for INTERMEDIATE mode (accepts P & M, returns Z and πI)

### Shared Libraries
- **shared/crypto.js** - Collision-resistant cryptographic helpers (H2, H3, derivations)
- **shared/storage-interface.js** - Abstract BrassCounterStore interface

### Storage Adapters
- **adapters/kv-store.js** - Community tier (best-effort, free)
- **adapters/durable-object-store.js** - Enterprise tier (atomic, paid)

### Configuration
- **wrangler.toml.example** - Configuration for deterministic verifier
- **issuer-wrangler.toml.example** - Configuration for issuer worker

## Quick Start (Deterministic Verifier v2.0)

### 1. Choose Your Tier

**Community Tier (Free):**
- Best-effort rate limiting using Cloudflare KV
- Free self-hosting
- Perfect for personal projects and open-source

**Enterprise Tier (Paid):**
- Atomic rate limiting using Durable Objects  
- Cryptographically enforced guarantees
- Requires Workers Paid plan ($5/month)

### 2. Configure Verifier Worker

```bash
# Copy example config
cp wrangler.toml.example wrangler.toml

# Edit wrangler.toml:
# - Set your Cloudflare account ID
# - Create KV namespace and set IDs
# - Set STORAGE_BACKEND = "kv" (Community) or "durable_objects" (Enterprise)

# Create KV namespace (required for both tiers)
wrangler kv:namespace create "BRASS_KV"
wrangler kv:namespace create "BRASS_KV" --preview

# For Enterprise tier, uncomment Durable Objects section in wrangler.toml

# Set required secrets (DO NOT commit these)
wrangler secret put BRASS_SECRET_KEY
# Enter: sk_live_your_secret_key_here

wrangler secret put BRASS_ISSUER_PUBKEY
# Enter: base64url encoded compressed P-256 point (Y = k·G from issuer)

wrangler secret put BRASS_KV_SECRET
# Enter: Generate with: openssl rand -base64 32
```

### 2. Configure Issuer Worker

```bash
# Copy example config
cp issuer-wrangler.toml.example issuer-wrangler.toml

# Edit issuer-wrangler.toml:
# - Set your Cloudflare account ID

# Generate issuer secret key (32 bytes = 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set the secret
wrangler secret put ISSUER_K_HEX --config issuer-wrangler.toml
# Paste the 64-char hex string generated above

# Compute public key Y = k·G and share with verifier
# (Use the test-vectors.js or a dedicated script to compute Y from k)
```

### 3. Deploy Workers

```bash
# Deploy verifier
wrangler deploy

# Deploy issuer (separate worker)
wrangler deploy --config issuer-wrangler.toml
```

### 4. Development Mode

```bash
# Run verifier locally
wrangler dev

# Run issuer locally (in separate terminal)
wrangler dev --config issuer-wrangler.toml
```

## Environment Variables

### Deterministic Verifier Worker (NEW)
**Required Secrets** (set via `wrangler secret put`):
- `BRASS_SECRET_KEY` - API key for verifier authentication
- `BRASS_ISSUER_PUBKEY` - Issuer public key (Y = k·G) as base64url P-256 compressed point
- `BRASS_KV_SECRET` - 32-byte secret for idempotency key derivation (base64url)

**Required Bindings** (configured in wrangler.toml):
- `BRASS_KV` - KV namespace for Community tier storage
- `BRASS_COUNTER` - Durable Object binding for Enterprise tier (optional)

**Configuration Variables**:
- `STORAGE_BACKEND` - "kv" (default, Community) or "durable_objects" (Enterprise)
- `BRASS_RATE_LIMIT` - Requests per window (default: 100)

### Legacy Strict Verifier Worker
- `BRASS_SECRET_KEY` - API key (secret)
- `BRASS_ISSUER_PUBKEY` - Issuer public key (secret)
- `KV` - KV namespace (legacy binding name)
- `COUNTER` - Durable Object (legacy binding name)

### Issuer Worker
- `ISSUER_K_HEX` - Issuer's private key as 64-character hex string (NEVER log or expose)

## Deterministic Protocol (v2.0)

### What Changed

**Old (strict-verifier.js):**
- Client supplies η (salt) and y (nullifier)
- Clients could manipulate η to evade rate limits
- Server validates but doesn't derive

**New (deterministic-verifier.js):**
- **Server derives η deterministically** from (IssuerPK, Origin, Epoch, Policy, Window)
- **Server derives y deterministically** from (enc(Z'), KID, AADr, η)
- Clients **cannot game** the system by choosing η
- **Stronger enforcement** with same privacy guarantees

### Cryptographic Derivations

```javascript
// Server-side derivation
η = H3('BRASS_SALT_v1', IssuerPK, OriginCanonical, EpochDays, PolicyID, WindowID)
y = H2('BRASS_NULLIFIER_v1', enc(Z'), KID, AADr, η)
IK = HMAC-SHA256(kvSecret, len(y) || y || len(c) || c)
```

**Why deterministic is safe:**
- η derived from **public context** (origin, policy, window), not user identity
- y still a cryptographic hash over **blinded token Z'** (issuer never sees plaintext)
- Clients still blind their messages (M = r·P) - issuer learns nothing about user
- Only difference: server controls window boundaries to prevent gaming

### Privacy Guarantees

**INTERMEDIATE Mode (Current):**
- **Issuer sees**: P = H1(origin || epoch) and M = r·P (blinded message)
- **Issuer does NOT see**: User identity, IP address (if behind OHTTP), final nullifier y, blinding factor r
- **Verifier sees**: y (nullifier), but cannot link to user (η rotates per window)
- **Recommendation**: Deploy issuer behind OHTTP relay to decouple IP metadata from origin
- **Per-redemption binding**: Client proof πC binds token to specific request context (method, path, body hash)

**Deterministic derivation does NOT compromise privacy:**
- η is a function of origin/policy/window (public data), not user identity
- y is still derived from blinded Z' which issuer never sees in plaintext
- Unlinkability preserved: different windows produce different y values
- Zero-knowledge proofs still prevent forgery

**FULL Mode (Roadmap):**
- **Complete issuer blindness**: Origin-authorization with ECVRF-alias ZK proofs
- **Issuer sees**: Nothing about the origin or user
- **Additional components needed**: OA module with linkage proofs

## Security Considerations

1. **Key Management**
   - Use `wrangler secret put` - NEVER commit secrets to git
   - Rotate issuer key periodically (update KID in coordination)
   - Keep BRASS_SECRET_KEY different from issuer secret

2. **OHTTP Deployment**
   - For pilot deployments, place issuer behind Cloudflare OHTTP relay
   - This decouples client IP from the origin they're protecting
   - See: https://blog.cloudflare.com/oblivious-http/

3. **Rate Limiting**
   - Durable Objects provide single-writer guarantees
   - KV fallback has eventual consistency (use for testing only)
   - Default limit: 10 requests per 60-second window per origin/policy

4. **Replay Protection**
   - Idempotency keys (y, c) pairs prevent token reuse
   - 120-second TTL on replay cache
   - Server recomputes d (request context) to prevent tampering

## Phase 1 Security Enhancements (GA-Ready)

### 1. Grace-Bridge Protection (UTC Midnight Boundary)

**Problem**: UTC midnight window transitions create a 60-second double-spend vulnerability where the same token could be redeemed in both W_prev (23:59:50 UTC) and W_curr (00:00:10 UTC).

**Solution**: Window-agnostic grace period deduplication

```javascript
// Grace nullifier (ignores window ID)
graceKey = H3('grace', Z', KID, IssuerPK, Origin, PolicyID)

// Detection: 60 seconds before/after midnight
isGracePeriod = (secondsInDay < 60) || (secondsInDay > 86340)

// Grace guard flow (during grace period only):
1. Check grace cache for graceKey → if HIT, return cached response
2. Process normal verification with window-specific y nullifier
3. Store response in grace cache with 120-second TTL
```

**Security properties:**
- ✅ Prevents cross-window replay during midnight boundary transitions
- ✅ Preserves privacy (graceKey still derived from blinded Z')
- ✅ Minimal performance impact (grace check only in 120-second daily window)
- ✅ Configurable via `BOUNDARY_GRACE_SECONDS` (default: 60)

**Storage backend support:**
- **Durable Objects**: Atomic SETNX guarantees no double-spend even under race conditions
- **KV**: Best-effort protection (eventual consistency may allow edge case races)

**Configuration:**
```toml
# wrangler.toml
[vars]
BOUNDARY_GRACE_SECONDS = "60"  # Global default (can be per-project in future)
```

**Observability:**
- Metric: `boundary_grace_replay` (grace cache hits)
- Metric: `boundary_denied` (rejections during grace period)
- Flag: `graceProtected: true` in verification response

### 2. TLS Channel Binding (Transcript Security)

**Breaking Change (v2.1)**: TLS exporter binding changed from constant label to cryptographic material.

**Old implementation:**
```javascript
// ❌ INSECURE: Same binding for all connections
tlsBinding = utf8ToBytes('no_exporter')
```

**New implementation:**
```javascript
// ✅ SECURE: Binds to actual TLS channel or domain-separated fallback
tlsBinding = tlsExporterBytes 
  ? H3('tls_exporter', tlsExporterBytes)  // Real TLS material
  : H3('no_exporter')                     // Domain-separated fallback
```

**Why this matters:**
- Prevents transcript forgery using captured TLS sessions
- Binds verification to specific TLS channel (if exporter available)
- Domain separation prevents collision attacks between exporter/non-exporter modes

**Migration path:**
- ✅ Self-hosted deployments: Update worker code, no client changes needed (server derives binding)
- ⚠️ Managed service: Requires client SDK update if exposing transcript inputs to clients

### 3. Point Encoding Validation

**Implementation**: Leverages audited `@noble/curves` library for P-256 validation.

**Security guarantees:**
```javascript
// Point decoding from compressed bytes (33 bytes)
export function decodePoint(encodedBytes) {
  try {
    const point = p256.ProjectivePoint.fromHex(encodedBytes);
    point.assertValidity();  // Checks:
                              // - Point on curve: y² = x³ - 3x + b
                              // - Non-zero point
                              // - Not point at infinity
                              // - Canonical encoding
    return point;
  } catch (error) {
    throw new Error('invalid_point_encoding');
  }
}
```

**Rejected inputs:**
- ✅ Non-canonical encodings (multiple representations of same point)
- ✅ Low-order points (group cofactor attacks)
- ✅ Point at infinity
- ✅ Points not on P-256 curve
- ✅ Invalid compressed point prefix (must be 0x02 or 0x03)

**Attack prevention:**
- Malleability attacks (same point, different encodings)
- Small subgroup attacks (low-order points)
- Invalid curve attacks (points not on P-256)

### 4. Storage Backend Guarantees

#### Durable Objects (Enterprise Tier)

**Atomicity guarantee**: Single-writer execution model
```javascript
// All requests to same counter ID execute sequentially
async handleSpend(request) {
  // 1. IK check (atomic read)
  const cached = await this.state.storage.get(ikKey);
  if (cached) return cached;  // Idempotent replay
  
  // 2. Counter increment (atomic)
  let count = await this.state.storage.get('count') || 0;
  if (count >= limit) { /* reject */ }
  count += 1;
  
  // 3. Store response (atomic writes)
  await Promise.all([
    this.state.storage.put('count', count),
    this.state.storage.put(ikKey, response)
  ]);
}
```

**Properties:**
- ✅ **No race conditions**: Cloudflare location brokering ensures single instance per counter ID
- ✅ **Sequential processing**: Requests queued and executed in order
- ✅ **Strong consistency**: All reads/writes to same DO instance are linearizable
- ✅ **Grace guard atomicity**: SETNX behavior for grace cache (check-then-set is atomic)

**Failure modes:**
- ✅ Partial writes limited to counter increments (acceptable for rate limiting accuracy)
- ✅ IK cache always written atomically with counter

#### KV Store (Community Tier)

**Consistency model**: Eventual consistency with edge replication

**Properties:**
- ⚠️ **Best-effort counters**: Race conditions possible under high concurrency
- ⚠️ **Replication lag**: Writes may take 60+ seconds to propagate globally
- ⚠️ **Grace guard races**: Eventual consistency may allow duplicate redemptions in rare cases
- ✅ **Good enough for**: Personal projects, low-traffic sites, development/testing

**Recommendations:**
- Use KV for prototyping and low-stakes applications
- Upgrade to Durable Objects for production workloads requiring strict enforcement
- Monitor `kv_conflict` telemetry metric for race condition frequency

**Cost comparison:**
- KV: Free tier (100K reads/day, 1K writes/day)
- Durable Objects: $5/month Workers Paid + $0.15 per million requests

### Configuration Reference

#### Environment Variables
```toml
# wrangler.toml
[vars]
STORAGE_BACKEND = "kv"              # or "durable_objects"
BOUNDARY_GRACE_SECONDS = "60"       # Grace period before/after midnight
BRASS_RATE_LIMIT = "100"            # Requests per window
```

#### Secrets (set via `wrangler secret put`)
```bash
BRASS_SECRET_KEY       # API key for verifier authentication
BRASS_ISSUER_PUBKEY    # Issuer public key (Y = k·G)
BRASS_KV_SECRET        # 32-byte secret for idempotency key derivation
```

### Testing Boundary Scenarios

**Run grace-bridge boundary tests:**
```bash
npx vitest run test/grace-bridge.test.js
```

**Expected output (all 23 tests passing):**
```
✓ isInGracePeriod - UTC Midnight Boundary Detection (6)
  ✓ should detect grace period within 60s after midnight
  ✓ should detect grace period within 60s before midnight
  ✓ should NOT detect grace period outside the window
  ✓ should handle different grace period durations
  ✓ should handle edge case: exactly at grace boundary
  ✓ should work across different days
✓ deriveGraceNullifier - Window-Agnostic Deduplication (7)
✓ deriveTlsBinding - Channel Binding Security (7)
✓ Grace-Bridge Integration Scenarios (3)
```

**Test coverage:**
- ✅ Grace period detection: 00:00:00-00:00:59.999 and 23:59:00.001-23:59:59.999
- ✅ Boundary exclusion: Exactly 60s marks (00:01:00, 23:59:00) are NOT in grace period
- ✅ Cross-window replay protection (same token at 23:59:50 and 00:00:10)
- ✅ Grace nullifier derivation (window-agnostic, deterministic)
- ✅ TLS binding (with exporter bytes vs. domain-separated fallback)
- ✅ Tenant isolation (different origins/policies/KIDs produce different nullifiers)

**Technical note:** Tests use strict inequality boundaries to prevent edge case double-spends. Grace periods are:
- After midnight: `[00:00:00.000, 00:01:00.000)` (inclusive start, exclusive end)
- Before midnight: `(23:59:00.000, 00:00:00.000)` (exclusive start, inclusive end)

## Testing

```bash
# Run boundary tests (recommended for validation)
npx vitest run test/grace-bridge.test.js

# Run integration test vectors (requires issuer running locally)
npm test

# Expected output:
# - Mints epoch pass with random blinding factor
# - Builds spend proof with πC bound to request context
# - Displays all cryptographic commitments
```

## Integration Example

### Frontend
```javascript
import { mintEpochPass, buildSpend } from './lib/brass-strict-client.js';

// On page load or daily
const token = await mintEpochPass({ 
  originCanonical: 'https://example.com',
  subPolicy: 'comments' 
});
localStorage.setItem('brass_token', JSON.stringify(token));

// On form submit
const spend = buildSpend({
  token,
  httpMethod: 'POST',
  normalizedPath: '/api/submit-comment',
  bodyBytes: new TextEncoder().encode(commentText)
});

// Send spend to your backend
await fetch('/api/submit-comment', {
  method: 'POST',
  headers: { 'x-brass-proof': JSON.stringify(spend) },
  body: JSON.stringify({ comment: commentText })
});
```

### Backend
```javascript
// Forward BRASS proof to verifier
const brassProof = req.headers['x-brass-proof'];
const verifyRes = await fetch('https://your-verifier.workers.dev/verify', {
  method: 'POST',
  headers: { 
    'authorization': `Bearer ${process.env.BRASS_SECRET_KEY}`,
    'content-type': 'application/json'
  },
  body: brassProof
});

if (!verifyRes.ok) {
  return res.status(429).json({ error: 'Rate limit exceeded' });
}

// Proceed with comment submission
const { remaining } = await verifyRes.json();
// Store comment, return remaining count
```

## Troubleshooting

### Error: "invalid_piC"
- Client-side d doesn't match server-side d
- Check that body bytes are identical between client and server
- Ensure request method and path are normalized correctly

### Error: "invalid_piI"
- Issuer public key mismatch
- Verify BRASS_ISSUER_PUBKEY matches the issuer's Y = k·G
- Check that issuer is using the same ISSUER_K_HEX

### Error: "y_mismatch"
- Salted token derivation failed
- Verify η (eta) is transmitted correctly
- Check KID and AADr match between mint and spend

### Error: "limit_exceeded"
- User has exceeded rate limit for this window
- Check window configuration (default 60 seconds)
- Verify counter is resetting properly

## Resources

- [RFC 9380 - Hash to Elliptic Curve](https://datatracker.ietf.org/doc/html/rfc9380)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/durable-objects/)
- [OHTTP Specification](https://datatracker.ietf.org/doc/html/draft-ietf-ohai-ohttp)
