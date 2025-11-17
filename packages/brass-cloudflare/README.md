# @brassproof/cloudflare

BRASS integration for Cloudflare Workers. Add privacy-preserving rate limiting to your Worker in minutes.

## Installation

```bash
npm install @brassproof/cloudflare
```

## Quick Start

```typescript
import { createBrassWorker } from '@brassproof/cloudflare'

const handler = async (request: Request, env: Env) => {
  const { message } = await request.json()
  
  // Your protected logic here
  return new Response(JSON.stringify({ 
    success: true,
    message: `Received: ${message}`
  }), {
    headers: { 'Content-Type': 'application/json' }
  })
}

export default {
  fetch: createBrassWorker(handler, {
    scope: 'message-submission',
    onVerified: (result) => {
      console.log(`✅ Verified! ${result.remaining} remaining`)
    },
  })
}
```

## Configuration

### Environment Variables (wrangler.toml)

```toml
[vars]
# Set via `wrangler secret put BRASS_SECRET_KEY`
# Set via `wrangler secret put BRASS_ISSUER_PUBKEY`

[[kv_namespaces]]
binding = "BRASS_KV"
id = "your_kv_namespace_id"
```

### Worker TypeScript Types

```typescript
export interface Env {
  BRASS_SECRET_KEY: string
  BRASS_ISSUER_PUBKEY: string
  BRASS_KV: KVNamespace
}
```

## API Reference

### `createBrassWorker(handler, options?)`

Creates a BRASS-protected Worker handler.

**Parameters:**

- `handler: (request: Request, env: Env) => Promise<Response> | Response` - Your worker logic
- `options?: BrassWorkerOptions` - Configuration options

**Options:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `scope` | `string` | `'generic'` | Rate limit scope identifier |
| `rateLimits` | `Record<string, RateLimit>` | Defaults | Custom rate limits per scope |
| `onVerified` | `(result) => void \| Promise<void>` | - | Called after successful verification |
| `onRateLimited` | `(result) => Response \| Promise<Response>` | - | Custom rate limit response |
| `corsHeaders` | `HeadersInit` | Allow all | Custom CORS headers |

## Complete Example

```typescript
// worker.ts
import { createBrassWorker, type BrassWorkerEnv } from '@brassproof/cloudflare'

interface Env extends BrassWorkerEnv {
  // Add your custom environment variables here
  MY_DATABASE: D1Database
}

const commentHandler = async (request: Request, env: Env): Promise<Response> => {
  const { author, comment } = await request.json()

  // Validate input
  if (!author || !comment) {
    return new Response(
      JSON.stringify({ error: 'Author and comment required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Save to database
  await env.MY_DATABASE.prepare(
    'INSERT INTO comments (author, comment, created_at) VALUES (?, ?, ?)'
  ).bind(author, comment, Date.now()).run()

  return new Response(
    JSON.stringify({ success: true, message: 'Comment posted!' }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

export default {
  fetch: createBrassWorker(commentHandler, {
    scope: 'comment-submission',
    rateLimits: {
      'comment-submission': { maxRequests: 3, windowSeconds: 86400 } // 3 per day
    },
    onVerified: (result) => {
      console.log(`✅ Comment verified! ${result.remaining} remaining`)
    },
    onRateLimited: ({ remaining, resetAt }) => {
      return new Response(
        JSON.stringify({
          error: 'Too many comments. Try again tomorrow!',
          remaining,
          resetAt: new Date(resetAt).toISOString()
        }),
        { 
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    },
  })
}
```

## Advanced Usage

### Custom CORS Headers

```typescript
export default {
  fetch: createBrassWorker(handler, {
    corsHeaders: {
      'Access-Control-Allow-Origin': 'https://yourdomain.com',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
```

### Multiple Scopes

```typescript
const handler = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  
  if (url.pathname === '/comment') {
    // Handle comment
  } else if (url.pathname === '/signup') {
    // Handle signup
  }
  
  return new Response('Not found', { status: 404 })
}

export default {
  fetch: createBrassWorker(handler, {
    rateLimits: {
      'comment': { maxRequests: 3, windowSeconds: 86400 },
      'signup': { maxRequests: 5, windowSeconds: 86400 },
    },
  })
}
```

### Direct Verifier Access

For more control, use the verifier directly:

```typescript
import { createBrassVerifier } from '@brassproof/cloudflare'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const verifier = createBrassVerifier({
      secretKey: env.BRASS_SECRET_KEY,
      issuerPublicKey: env.BRASS_ISSUER_PUBKEY,
      kvNamespace: env.BRASS_KV,
    })

    const { brassToken } = await request.json()
    
    const result = await verifier.verify(brassToken, {
      origin: request.headers.get('origin') || '',
      scope: 'custom-scope',
    })

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 429
      })
    }

    // Your logic here...
    return new Response('Success')
  }
}
```

## Deployment

### 1. Install Wrangler

```bash
npm install -g wrangler
```

### 2. Create KV Namespace

```bash
wrangler kv:namespace create BRASS_KV
```

Copy the ID to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BRASS_KV"
id = "paste_namespace_id_here"
```

### 3. Set Secrets

```bash
wrangler secret put BRASS_SECRET_KEY
wrangler secret put BRASS_ISSUER_PUBKEY
```

### 4. Deploy

```bash
wrangler deploy
```

## Environment Setup

Get the issuer public key:

**For self-hosted deployment:**
```bash
curl https://your-issuer.workers.dev/pub
```

**For managed service:**
Get from [brassproof.com](https://brassproof.com) dashboard

Then set it as a secret:

```bash
wrangler secret put BRASS_ISSUER_PUBKEY
# Paste the public key when prompted
```

See [SECURITY.md](../../SECURITY.md) for complete self-hosting guide.

## Learn More

- [@brassproof/verifier](https://www.npmjs.com/package/@brassproof/verifier) - Core verifier SDK
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [BRASS Documentation](https://docs.brassproof.com)

## License

MIT - see [LICENSE](./LICENSE) for details.
