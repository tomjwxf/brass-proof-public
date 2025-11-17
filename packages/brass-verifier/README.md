# @brassproof/verifier

Official BRASS protocol verifier SDK for Node.js and edge runtimes. Verify blinded tokens, enforce rate limits, and prevent abuse with privacy-preserving cryptography.

## Features

- ✅ **DLEQ Proof Verification**: Cryptographic validation of issuer and client proofs
- ✅ **Rate Limiting**: Configurable per-scope rate limits without tracking user identity
- ✅ **Replay Protection**: Prevent token reuse with idempotency key tracking
- ✅ **Edge-Ready**: Works in Cloudflare Workers, Vercel Edge, and Node.js
- ✅ **TypeScript**: Full type safety and IntelliSense support
- ✅ **Self-Hostable**: No external dependencies for core verification
- 🆕 **Privacy-Safe Telemetry**: Opt-in anonymized metrics for analytics and auto-tuning
- 🆕 **Embeddable Badge**: "Protected by BRASS Proof" widget builds user trust

## Installation

```bash
npm install @brassproof/verifier
```

## Quick Start

```typescript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY!,
  kvNamespace: yourKVStore, // Optional: for rate limiting and replay protection
  rateLimits: {
    'comment-submission': { maxRequests: 3, windowSeconds: 86400 },
    'signup': { maxRequests: 5, windowSeconds: 86400 },
  },
  replayWindowSeconds: 3600,
  // Optional: Enable telemetry for analytics and auto-tuning
  telemetry: {
    enabled: true,
    tenantId: 'your-project-id',
  },
})

const result = await verifier.verify(
  payload, // BRASS spend payload from client
  {
    origin: 'https://example.com',
    scope: 'comment-submission',
    clientIp: req.ip,
  }
)

if (result.success) {
  console.log('✅ Token verified!', result.remaining, 'requests remaining')
  // Process the request...
} else {
  console.error('❌ Verification failed:', result.error)
  // Reject the request
}
```

## Configuration

### BrassVerifierConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `secretKey` | `string` | ✅ | Your BRASS API secret key |
| `issuerPublicKey` | `string` | ✅ | Public key from your BRASS issuer |
| `issuerUrl` | `string` | ❌ | Issuer endpoint URL (for future features) |
| `kvNamespace` | `KVNamespace` | ❌ | Key-value store for rate limiting and replay protection |
| `rateLimits` | `Record<string, RateLimit>` | ❌ | Custom rate limits per scope |
| `replayWindowSeconds` | `number` | ❌ | How long to track used tokens (default: 3600) |

### Default Rate Limits

```typescript
{
  'comment-submission': { maxRequests: 3, windowSeconds: 86400 }, // 3 per day
  'signup': { maxRequests: 5, windowSeconds: 86400 },            // 5 per day
  'generic': { maxRequests: 10, windowSeconds: 86400 },          // 10 per day
}
```

## Usage Examples

### Node.js / Express

```typescript
import express from 'express'
import { createBrassVerifier } from '@brassproof/verifier'

const app = express()
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY!,
})

app.post('/api/submit-comment', async (req, res) => {
  const brassToken = req.headers['x-brass-token']
  
  // Parse BRASS payload
  const payload = JSON.parse(Buffer.from(brassToken, 'base64').toString())
  
  const result = await verifier.verify(payload, {
    origin: req.headers.origin,
    scope: 'comment-submission',
  })
  
  if (!result.success) {
    return res.status(429).json({ error: result.error })
  }
  
  // Process comment...
  res.json({ success: true, remaining: result.remaining })
})
```

### Cloudflare Workers

```typescript
import { createBrassVerifier } from '@brassproof/verifier'

export default {
  async fetch(request: Request, env: Env) {
    const verifier = createBrassVerifier({
      secretKey: env.BRASS_SECRET_KEY,
      issuerPublicKey: env.BRASS_ISSUER_PUBKEY,
      kvNamespace: env.BRASS_KV,
    })
    
    const payload = await request.json()
    
    const result = await verifier.verify(payload, {
      origin: request.headers.get('origin') || '',
      scope: 'comment-submission',
    })
    
    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 429 }
      )
    }
    
    return new Response(JSON.stringify({ success: true }))
  }
}
```

### Next.js API Route

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY!,
})

export async function POST(request: NextRequest) {
  const payload = await request.json()
  
  const result = await verifier.verify(payload.brassToken, {
    origin: request.headers.get('origin') || '',
    scope: 'comment-submission',
  })
  
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 429 })
  }
  
  return NextResponse.json({ success: true, remaining: result.remaining })
}
```

## Security Checklist

Before deploying to production:

- [ ] **Store secrets securely**: Use environment variables, never commit to git
- [ ] **Rotate keys periodically**: Plan for key rotation every 90 days
- [ ] **Enable rate limiting**: Always provide a KV namespace for production
- [ ] **Enable replay protection**: Essential for preventing token reuse
- [ ] **Use HTTPS only**: BRASS tokens must be transmitted over secure connections
- [ ] **Validate origins**: Check that request origins match expected domains
- [ ] **Monitor usage**: Track verification failures and rate limit hits
- [ ] **Set appropriate rate limits**: Balance security with user experience

## Telemetry & Analytics

BRASS includes **opt-in telemetry** that powers managed service features like analytics dashboards and auto-calibrated rate limits.

### What's Collected (Privacy-Safe)

- ✅ **Anonymized verification counts** per epoch/scope
- ✅ **Threshold crossing events** (50k, 500k, 2M tokens)
- ❌ **NO user data, IP addresses, or PII**
- ❌ **NO tracking of individual requests**

### Enabling Telemetry (Opt-In)

Telemetry is **disabled by default** for privacy. Enable it to access managed service features:

**Option 1: Environment Variables**
```bash
BRASS_TELEMETRY_ENABLED=true  # Must explicitly set to 'true' to enable
BRASS_TELEMETRY_ENDPOINT=https://telemetry.brassproof.com/ingest
BRASS_TENANT_ID=your-project-id
```

**Option 2: Configuration**
```typescript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  telemetry: {
    enabled: true,
    endpoint: 'https://telemetry.brassproof.com/ingest',
    tenantId: 'your-project-id',
    onThreshold: (threshold, count) => {
      console.log(`Reached ${threshold} verifications! (current: ${count})`)
      // Custom logic: send Slack notification, trigger alert, etc.
    },
  },
})
```

### Telemetry is Disabled by Default

No action needed - telemetry is off unless you explicitly enable it. If you've enabled it and want to disable:

```bash
# Remove or set to false
BRASS_TELEMETRY_ENABLED=false
```

```typescript
// Or explicitly disable in code
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  telemetry: { enabled: false },
})
```

### Custom Threshold Handlers

```typescript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  telemetry: {
    enabled: true,
    thresholds: [10000, 50000, 100000], // Custom thresholds
    onThreshold: async (threshold, count) => {
      // Send to Slack
      await fetch(process.env.SLACK_WEBHOOK!, {
        method: 'POST',
        body: JSON.stringify({
          text: `🎉 BRASS milestone: ${count} tokens verified!`,
        }),
      })
    },
  },
})
```

## 🎯 Calibration Marketplace

Skip the trial-and-error! Use battle-tested security profiles for common use cases.

### Available Profiles

| Profile | Use Case | Rate Limit | Token Expiry | Tested With |
|---------|----------|------------|--------------|-------------|
| `comments` | Blog comments, forum posts, reviews | 3 req/day | 5min | 500k+ submissions |
| `signup` | User registration, trial signups | 5 req/hour | 10min | 2M+ signups |
| `api` | REST APIs, GraphQL, webhooks | 60 req/min | 2min | 50M+ API calls |
| `ecommerce` | Checkout, payments, cart operations | 10 req/hour | 30min | 10M+ transactions |

### Quick Start

```typescript
import { createBrassVerifier } from '@brassproof/verifier'

// Instantly configure for your use case
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  calibrationProfile: 'ecommerce', // Pre-tuned for checkout flows
})
```

Output:
```
[BRASS] Applied calibration profile: "ecommerce" (1.0)
  Description: Checkout flows and high-value transactions
  Rate Limit: 10 requests per 3600s
  Token Expiry: 1800s
  Certification: brass-verified
```

### Override Specific Settings

```typescript
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  calibrationProfile: 'comments',
  profileOverrides: {
    rateLimit: { maxRequests: 5 }, // Allow 5 comments/day instead of 3
    tokens: { maxAgeSeconds: 600 }  // Extend token lifetime to 10min
  }
})
```

### List Available Profiles

```typescript
import { listProfiles } from '@brassproof/verifier'

const profiles = listProfiles()
profiles.forEach(p => {
  console.log(`${p.name}: ${p.description}`)
  console.log(`  Tested with: ${p.metadata.testedWith}`)
  console.log(`  Warnings: ${p.metadata.warnings?.join(', ')}`)
})
```

### Get Profile Recommendation

```typescript
import { recommendProfile } from '@brassproof/verifier'

const profile = recommendProfile('user comments on blog posts')
// Returns: 'comments'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  calibrationProfile: profile,
})
```

### 🚀 Managed Service Enhancements (Private Beta)

**Available to managed customers** via private beta invitation:
- **Auto-calibration** based on real attack patterns from aggregated telemetry
- **Industry benchmarks** from similar deployments across the network
- **A/B tested profiles** optimized for conversion vs. security
- **Real-time adjustments** as new threats evolve

These advanced features build on the core calibration profiles available to all users today. See the [main README feature table](../../README.md#-feature-availability) for current availability.

Contact sales@brassproof.com for private beta access.

---

## 🚨 Alert Webhooks

Get notified when critical events occur. Perfect for DDoS detection, rate limit monitoring, and security incident response.

### Basic Setup

```typescript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  telemetry: {
    enabled: true,
    alerts: {
      webhooks: [{
        url: 'https://your-alerting-service.com/hook',
        secret: process.env.WEBHOOK_SECRET // For HMAC signature verification
      }],
      severities: ['critical'], // Only send critical alerts (DDoS, massive abuse)
      maxAlertsPerDay: 5,       // Prevent alert spam
      dryRun: true              // Test config without sending (RECOMMENDED for testing)
    }
  }
})
```

### Alert Severities

| Severity | When to Use | Examples |
|----------|-------------|----------|
| `critical` | Infrastructure threats, massive abuse | DDoS attack, 10x traffic spike, complete service outage |
| `warning` | Elevated activity, potential issues | 2-5x traffic increase, sustained high rate limit hits |
| `info` | Milestone events, normal operations | Threshold reached (50k tokens), new deployment |

**Default:** `critical` only (prevents alert fatigue)

### Webhook Payload

Alerts are sent as POST requests with HMAC SHA-256 signatures:

```json
{
  "alert": {
    "severity": "critical",
    "title": "DDoS Attack Detected",
    "message": "Traffic spike: 10x normal rate detected on /api/submit",
    "timestamp": 1699123456789,
    "metadata": {
      "scope": "api",
      "currentRate": 1000,
      "normalRate": 100
    }
  },
  "tenantId": "your-project-id",
  "timestamp": 1699123456789
}
```

**Headers:**
```
Content-Type: application/json
X-BRASS-Event: alert
X-Brass-Signature: sha256=<hmac_sha256_hex>
```

### Verify Webhook Signatures

```typescript
import crypto from 'crypto'

function verifyWebhook(req: Request, secret: string): boolean {
  const signature = req.headers['x-brass-signature']
  const payload = JSON.stringify(req.body)
  
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  const expected = `sha256=${hmac.digest('hex')}`
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
```

### Slack Integration

```typescript
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  telemetry: {
    enabled: true,
    alerts: {
      slack: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL!
      },
      severities: ['critical', 'warning'],
      maxAlertsPerDay: 10
    }
  }
})
```

### Alert Rate Limiting

Alerts include built-in protections against spam:

- **Daily cap**: Default 5 alerts/day (configurable)
- **Debouncing**: 60-minute window prevents duplicate alerts
- **Severity filtering**: Only send configured severity levels
- **Dry run mode**: Test without actually sending webhooks

```typescript
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY!,
  telemetry: {
    enabled: true,
    alerts: {
      webhooks: [{ url: '...' }],
      maxAlertsPerDay: 10,      // Raise limit for high-volume apps
      debounceMinutes: 30,      // Reduce debounce for faster alerts
      dryRun: true,             // Test mode: logs alerts without sending
      severities: ['critical']  // Only the most important events
    }
  }
})
```

### Manual Alert Triggering

```typescript
import { Telemetrist } from '@brassproof/verifier'

const telemetrist = new Telemetrist({
  enabled: true,
  alerts: {
    webhooks: [{ url: '...' }],
    severities: ['critical'],
    dryRun: false
  }
})

// Trigger custom alert
await telemetrist.emitAlert({
  severity: 'critical',
  title: 'Database Connection Lost',
  message: 'Primary database unreachable for 30 seconds',
  timestamp: Date.now(),
  metadata: { database: 'postgres-primary', downtime: 30 }
})
```

### 🚀 Managed Service Integrations (Private Beta)

**Available to managed customers** via invitation-only beta:
- **Zero-config Slack/PagerDuty** integrations
- **SMS alerts** via managed Twilio integration
- **Anomaly detection** powered by machine learning
- **Smart alerting** that learns your patterns to reduce noise
- **Guaranteed delivery** with automatic retry and fallback

Core webhook support (shown above) is available to all users today. See the [main README feature table](../../README.md#-feature-availability) for current availability.

Contact sales@brassproof.com for private beta access.

---

## "Protected by BRASS Proof" Badge

Show your users you're using privacy-first abuse prevention with an embeddable badge (similar to reCAPTCHA).

### React Component

**Note:** Badge is exported separately to avoid forcing React as a dependency for server-side users.

```tsx
import { BrassBadge } from '@brassproof/verifier/badge'

function App() {
  return (
    <div>
      <h1>Your App</h1>
      {/* Badge appears in bottom-right by default */}
      <BrassBadge />
    </div>
  )
}
```

### Customization

```tsx
<BrassBadge
  position="bottom-left"
  variant="compact"
  theme="dark"
  linkUrl="https://brassproof.com"
/>

{/* Disable badge */}
<BrassBadge enabled={false} />
```

### Vanilla JavaScript

```html
<script src="https://cdn.brassproof.com/badge.js"></script>
<script>
  BRASSBadge.init({
    position: 'bottom-right',
    variant: 'default',
    theme: 'auto', // Follows system dark mode preference
  })
</script>

<!-- Disable badge -->
<script>
  BRASSBadge.init({ enabled: false })
</script>
```

### Badge Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Show/hide badge |
| `position` | `'bottom-right'` \| `'bottom-left'` \| `'top-right'` \| `'top-left'` | `'bottom-right'` | Badge position |
| `variant` | `'default'` \| `'minimal'` \| `'compact'` | `'default'` | Badge size/style |
| `theme` | `'light'` \| `'dark'` \| `'auto'` | `'auto'` | Color scheme |
| `linkUrl` | `string` | `'https://brassproof.com'` | Where badge links to |

## Environment Variables

```bash
# Required
BRASS_SECRET_KEY=your_secret_key_here
BRASS_ISSUER_PUBKEY=issuer_public_key_hex

# Optional - Telemetry
BRASS_TELEMETRY_ENABLED=true
BRASS_TELEMETRY_ENDPOINT=https://telemetry.brassproof.com/ingest
BRASS_TENANT_ID=your-project-id

# Optional - Verifier
BRASS_ISSUER_URL=https://brass-issuer.your-domain.workers.dev
```

## API Reference

### `createBrassVerifier(config: BrassVerifierConfig): BrassVerifier`

Creates a new BRASS verifier instance.

### `verifier.verify(payload: BrassSpendPayload, context: VerificationContext): Promise<VerificationResult>`

Verifies a BRASS token and enforces rate limits.

**Parameters:**
- `payload`: The BRASS spend payload from the client
- `context`: Verification context including origin and scope

**Returns:**
```typescript
{
  success: boolean
  error?: string           // Error message if verification failed
  remaining?: number       // Remaining requests in current window
  resetAt?: number        // Timestamp when rate limit resets
  metadata?: object       // Additional verification metadata
}
```

## Self-Hosting

See [docs/verifier.md](./docs/verifier.md) for complete self-hosting instructions including:
- Cloudflare Worker deployment
- Durable Objects setup for distributed counters
- KV namespace configuration
- Key generation and rotation

## Learn More

- [BRASS Documentation](https://docs.brassproof.com)
- [Self-Hosting Guide](./docs/verifier.md)
- [Cloudflare Worker Example](./examples/cloudflare-worker)
- [Security Whitepaper](https://brassproof.com/whitepaper.pdf)

## Support

- **GitHub Issues**: [Report bugs](https://github.com/brassproof/brass-verifier/issues)
- **Documentation**: [docs.brassproof.com](https://docs.brassproof.com)
- **Email**: support@brassproof.com

## License

MIT - see [LICENSE](./LICENSE) for details.
