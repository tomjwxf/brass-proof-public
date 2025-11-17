# BRASS Security & Self-Hosting Guide

## Table of Contents

1. [Security Overview](#security-overview)
2. [Self-Hosting Architecture](#self-hosting-architecture)
3. [Deployment Guide](#deployment-guide)
4. [Security Best Practices](#security-best-practices)
5. [Vulnerability Reporting](#vulnerability-reporting)

---

## Security Overview

BRASS is designed with privacy and security as core principles:

### Cryptographic Guarantees

- **Blinded Token Protocol**: Issuer cannot link token issuance to token spending
- **Zero-Knowledge Proofs**: DLEQ proofs ensure cryptographic correctness without revealing secrets
- **Deterministic Verification**: Rate limits enforced without tracking individual users
- **No IP Logging**: Privacy-preserving counters based on cryptographic commitments

### Security Features

- **HMAC-SHA256**: API keys hashed with per-key pepper
- **TLS Channel Binding**: HTTP request binding prevents token replay attacks
- **Point Encoding Validation**: Ensures all elliptic curve points are valid
- **Fiat-Shamir Transform**: Length-prefixed encoding prevents collision attacks

---

## Self-Hosting Architecture

BRASS supports multiple deployment models:

### Option 1: Fully Self-Hosted (Recommended for Privacy)

**Components:**
- Your own issuer worker
- Your own verifier worker
- Your application backend

**Benefits:**
- ✅ Complete control over all data
- ✅ No external dependencies
- ✅ Full privacy guarantees
- ✅ Customizable rate limiting logic

**Setup Time:** ~30 minutes

### Option 2: Managed Issuer + Self-Hosted Verifier

**Components:**
- Hosted issuer at `https://brassproof.com`
- Your own verifier worker
- Your application backend

**Benefits:**
- ✅ Easier setup
- ✅ Maintained issuer infrastructure
- ✅ Control over rate limiting
- 🟡 Trust required for issuer

**Setup Time:** ~15 minutes

### Option 3: Fully Managed

Use the [BRASS platform](https://brassproof.com) for complete hosting, monitoring, and billing.

---

## Deployment Guide

### Prerequisites

- Node.js 18+ or Bun
- Cloudflare account (for Workers deployment)
- Wrangler CLI: `npm install -g wrangler`

### Step 1: Generate Secrets

```bash
# Generate a strong secret key (32 bytes hex)
openssl rand -hex 32

# Output: e.g., a1b2c3d4e5f6...
# Save this as BRASS_SECRET_KEY
```

### Step 2: Deploy Issuer Worker

```bash
cd worker/

# Login to Cloudflare
wrangler login

# Deploy issuer
wrangler deploy issuer-cloudflare.js

# Set secret key
wrangler secret put BRASS_SECRET_KEY
# (Paste the secret generated in Step 1)

# Get the issuer public key
curl https://your-issuer.workers.dev/pub
# Save this as BRASS_ISSUER_PUBKEY
```

### Step 3: Deploy Verifier Worker (Optional)

For self-hosted verification:

```bash
# Deploy verifier
wrangler deploy verifier-cloudflare.js

# Set secrets
wrangler secret put BRASS_SECRET_KEY
# (Same secret as issuer)

# Create KV namespace for counters
wrangler kv:namespace create "BRASS_COUNTERS"

# Update wrangler.toml with KV binding
# kv_namespaces = [
#   { binding = "BRASS_COUNTERS", id = "your_kv_id" }
# ]
```

### Step 4: Configure Your Application

```bash
# In your application .env file
BRASS_SECRET_KEY=a1b2c3d4e5f6...  # From Step 1
BRASS_ISSUER_PUBKEY=Ax...         # From Step 2

# Optional: Custom endpoints
BRASS_ISSUER_URL=https://your-issuer.workers.dev
BRASS_VERIFIER_URL=https://your-verifier.workers.dev
```

### Step 5: Integrate the SDK

```javascript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY,
  rateLimits: {
    'api-requests': { maxRequests: 100, windowSeconds: 86400 }
  }
})

// In your API route
app.post('/api/endpoint', async (req, res) => {
  const result = await verifier.verify(req.body.brassToken, {
    origin: req.headers.origin,
    scope: 'api-requests',
    context: req.path
  })
  
  if (!result.success) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      retryAfter: result.retryAfter 
    })
  }
  
  // Process protected request
})
```

---

## Security Best Practices

### 1. Secret Management

**DO:**
- ✅ Use environment variables for all secrets
- ✅ Rotate `BRASS_SECRET_KEY` periodically (quarterly recommended)
- ✅ Use different secrets for dev/staging/production
- ✅ Use Cloudflare `wrangler secret` for Workers
- ✅ Use secure secret managers (AWS Secrets Manager, HashiCorp Vault)

**DON'T:**
- ❌ Hardcode secrets in code
- ❌ Commit `.env` files to git
- ❌ Share secrets via email/Slack
- ❌ Reuse secrets across environments

### 2. Rate Limiting Configuration

**Conservative Limits:**
```javascript
rateLimits: {
  'comment-submission': { 
    maxRequests: 3,      // 3 comments per day
    windowSeconds: 86400 
  },
  'api-calls': { 
    maxRequests: 1000,   // 1000 requests per hour
    windowSeconds: 3600 
  }
}
```

**Best Practices:**
- Start with restrictive limits and adjust based on legitimate usage
- Use different scopes for different actions
- Monitor `retryAfter` values to identify potential abuse
- Log rate limit violations for security analysis

### 3. Origin Validation

Always validate the `origin` header:

```javascript
const allowedOrigins = [
  'https://yourapp.com',
  'https://www.yourapp.com'
]

const result = await verifier.verify(token, {
  origin: req.headers.origin,
  scope: 'api-requests',
  validateOrigin: (origin) => allowedOrigins.includes(origin)
})
```

### 4. HTTPS Only

**CRITICAL:** Always use HTTPS in production:

```javascript
// Enforce HTTPS in Express
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect('https://' + req.headers.host + req.url)
  }
  next()
})
```

### 5. Monitoring & Logging

**Log these events:**
- Rate limit violations (potential abuse)
- Invalid token attempts
- Origin mismatches
- Cryptographic verification failures

**Example:**
```javascript
if (!result.success) {
  console.warn('BRASS verification failed', {
    reason: result.error,
    origin: req.headers.origin,
    scope: options.scope,
    timestamp: new Date().toISOString()
  })
}
```

### 6. Key Rotation

To rotate your `BRASS_SECRET_KEY`:

1. Generate a new secret key
2. Update verifier to accept **both** old and new keys
3. Wait for old tokens to expire (max 24 hours)
4. Remove old key from configuration

```javascript
const verifier = createBrassVerifier({
  secretKey: [process.env.BRASS_SECRET_KEY_NEW, process.env.BRASS_SECRET_KEY_OLD],
  // ... other config
})
```

---

## Vulnerability Reporting

### Reporting Security Issues

**DO NOT** open public GitHub issues for security vulnerabilities.

Instead, please email: **security@brassproof.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Your recommended fix (if any)

### Response Timeline

- **Initial Response:** Within 48 hours
- **Vulnerability Assessment:** Within 7 days
- **Fix Timeline:** Based on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release cycle

### Bug Bounty

We currently do not have a formal bug bounty program, but we appreciate responsible disclosure and will publicly acknowledge security researchers (with permission).

---

## Security Audits

BRASS is an open-source project. We encourage:

- Code audits
- Cryptographic protocol reviews
- Penetration testing of self-hosted deployments

If you conduct a security audit, please share your findings at **security@brassproof.com**.

---

## Open Source Verifier

The BRASS verifier is open source (MIT license) and available for inspection:

- **Core Verifier SDK:** [`packages/brass-verifier/`](./packages/brass-verifier/)
- **Cloudflare Worker:** [`worker/verifier-cloudflare.js`](./worker/verifier-cloudflare.js)
- **Test Suite:** [`test/`](./test/)

You can audit the cryptographic implementation and verify:
- No behavioral fingerprinting
- No PII collection
- No tracking or logging of user data
- Correct implementation of blinded token protocol

---

## Additional Resources

- **Cryptographic Specification:** See `docs/protocol/crypto-spec.md`
- **API Documentation:** [brassproof.com/docs](https://brassproof.com/docs)
- **GitHub Discussions:** [Discussions](https://github.com/tomjwxf/brass-proof-public/discussions)

---

**Last Updated:** November 14, 2025

**Contact:** security@brassproof.com
