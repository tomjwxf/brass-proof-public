# Self-Hosting the BRASS Verifier

This guide explains how to self-host the BRASS verifier for complete control over your rate limiting infrastructure.

## Overview

The BRASS verifier is responsible for:
1. **DLEQ Proof Verification**: Validating cryptographic proofs from issuer and client
2. **Rate Limiting**: Enforcing request limits per scope without tracking user identity  
3. **Replay Protection**: Preventing token reuse via idempotency tracking
4. **Request Binding**: Ensuring tokens are bound to specific HTTP requests

## Architecture

```
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
│ Client  │────>│ Issuer  │     │ Verifier │<────│  Your    │
│         │<────│         │     │          │     │  Backend │
└─────────┘     └─────────┘     └──────────┘     └──────────┘
                                      │
                                      ▼
                                ┌──────────┐
                                │ KV Store │
                                │ (Counters│
                                │ + Replay)│
                                └──────────┘
```

## Deployment Options

### Option 1: Cloudflare Workers (Recommended)

Cloudflare Workers provides edge deployment with built-in KV storage and Durable Objects for distributed counters.

**See**: [examples/cloudflare-worker](../examples/cloudflare-worker) for complete implementation.

**Advantages**:
- Global edge network (low latency)
- Built-in KV and Durable Objects
- Generous free tier
- Auto-scaling

**Setup**:

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Create worker from example:
```bash
cp examples/cloudflare-worker/index.js worker.js
cp examples/cloudflare-worker/wrangler.toml wrangler.toml
```

3. Configure secrets:
```bash
wrangler secret put BRASS_SECRET_KEY
wrangler secret put BRASS_ISSUER_PUBKEY
```

4. Deploy:
```bash
wrangler deploy
```

### Option 2: Vercel Edge Functions

Works with Next.js and Vercel deployments.

```typescript
// api/verify/route.ts
import { createBrassVerifier } from '@brassproof/verifier'

export const config = {
  runtime: 'edge',
}

export async function POST(request: Request) {
  const verifier = createBrassVerifier({
    secretKey: process.env.BRASS_SECRET_KEY!,
    issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY!,
  })
  
  const payload = await request.json()
  const result = await verifier.verify(payload, {
    origin: request.headers.get('origin') || '',
    scope: 'generic',
  })
  
  return Response.json(result)
}
```

### Option 3: Node.js / Express

Traditional server deployment with Redis for storage.

```typescript
import express from 'express'
import Redis from 'ioredis'
import { createBrassVerifier } from '@brassproof/verifier'

const redis = new Redis(process.env.REDIS_URL)

const kvAdapter = {
  async get(key: string) {
    return await redis.get(key)
  },
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    if (options?.expirationTtl) {
      await redis.setex(key, options.expirationTtl, value)
    } else {
      await redis.set(key, value)
    }
  },
  async delete(key: string) {
    await redis.del(key)
  },
}

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY!,
  kvNamespace: kvAdapter,
})
```

## Configuration

### Required Environment Variables

```bash
# Your BRASS API secret key (64+ char hex string)
BRASS_SECRET_KEY=your_secret_key_here

# Issuer's public key (obtain from issuer's /pub endpoint)
BRASS_ISSUER_PUBKEY=issuer_public_key_hex
```

### Obtaining Issuer Public Key

For self-hosted issuer:
```bash
curl https://your-issuer.workers.dev/pub
```

For managed service, get the public key from [brassproof.com](https://brassproof.com) dashboard.

### Rate Limit Configuration

Customize rate limits per scope:

```typescript
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY!,
  rateLimits: {
    'comment-submission': { 
      maxRequests: 3, 
      windowSeconds: 86400  // 3 per day
    },
    'signup': { 
      maxRequests: 5, 
      windowSeconds: 86400  // 5 per day
    },
    'api-call': { 
      maxRequests: 100, 
      windowSeconds: 3600   // 100 per hour
    },
  },
})
```

## Storage Backend

### Cloudflare KV (Recommended for Workers)

Automatically configured in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BRASS_KV"
id = "your_namespace_id"
```

### Cloudflare Durable Objects (For Distributed Counters)

For highly accurate distributed rate limiting:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["RateLimitCounter"]

[[durable_objects.bindings]]
name = "RATE_LIMIT_COUNTER"
class_name = "RateLimitCounter"
script_name = "brass-verifier"
```

### Redis (For Node.js)

See Option 3 above for Redis adapter implementation.

### Custom KV Adapter

Implement the `KVNamespace` interface:

```typescript
interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}
```

## Security Considerations

### Key Management

- **Generate strong keys**: Use cryptographically secure random key generation
- **Rotate regularly**: Plan for key rotation every 90 days
- **Store securely**: Use environment variables, never commit to git
- **Separate environments**: Different keys for dev/staging/prod

### Key Generation

```bash
# Generate BRASS_SECRET_KEY (64-char hex)
openssl rand -hex 32

# Issuer generates their private key and shares public key with you
```

### Network Security

- **HTTPS only**: Always use TLS for all communications
- **Origin validation**: Verify request origins match expected domains
- **Rate limit endpoints**: Protect verifier endpoint itself from DoS
- **CORS configuration**: Restrict allowed origins

### Monitoring

Monitor these metrics:
- Verification success/failure rates
- Rate limit hits per scope
- Replay protection triggers
- Unusual traffic patterns

## Troubleshooting

### "Issuer DLEQ proof verification failed"

- **Cause**: Issuer public key mismatch or corrupted token
- **Fix**: Verify `BRASS_ISSUER_PUBKEY` matches issuer's public key

### "Token already used (replay detected)"

- **Cause**: Client resubmitted same token
- **Fix**: This is expected behavior for replay protection. Client should mint new token.

### "Rate limit exceeded"

- **Cause**: User hit rate limit for scope
- **Fix**: This is expected behavior. Wait for rate limit window to reset.

### "Request binding mismatch (d != d_computed)"

- **Cause**: Token not properly bound to request, or request modified after token creation
- **Fix**: Ensure client correctly computes request context hash

## Integration with Managed Issuer

If using the managed BRASS service at [brassproof.com](https://brassproof.com):

1. Get issuer public key from dashboard or API

2. Configure verifier:
```typescript
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY!,
  issuerUrl: process.env.BRASS_ISSUER_URL,
})
```

3. Set environment variables:
```bash
BRASS_ISSUER_URL=https://your-issuer-endpoint.com
BRASS_ISSUER_PUBKEY=your_issuer_public_key
```

## Performance Tuning

### Caching Issuer Public Key

Cache the issuer public key to avoid repeated parsing:

```typescript
let cachedVerifier: BrassVerifier | null = null

function getVerifier() {
  if (!cachedVerifier) {
    cachedVerifier = createBrassVerifier({ /* config */ })
  }
  return cachedVerifier
}
```

### Batch Verification

For high-throughput scenarios, consider batching verifications:

```typescript
const results = await Promise.all(
  payloads.map(payload => 
    verifier.verify(payload, context)
  )
)
```

### Edge Caching

Use edge caching for issuer public key retrieval:

```typescript
const publicKey = await fetch(issuerUrl + '/pub', {
  cf: { cacheTtl: 3600 }
})
```

## Production Checklist

- [ ] HTTPS enabled everywhere
- [ ] Environment variables configured
- [ ] KV namespace or storage backend set up
- [ ] Rate limits configured appropriately
- [ ] Replay protection enabled
- [ ] Monitoring and alerting configured
- [ ] Key rotation plan documented
- [ ] Backup strategy for KV data
- [ ] Load testing completed
- [ ] Error handling tested

## Learn More

- [BRASS Protocol Specification](https://brassproof.com/spec)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Security Best Practices](https://docs.brassproof.com/security)
- [API Reference](../README.md#api-reference)
