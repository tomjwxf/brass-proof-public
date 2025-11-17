# BRASS Express.js Example

A simple Express.js application demonstrating BRASS-protected API endpoints.

## Features

- 🛡️ BRASS-protected comment submission endpoint
- ⚡ Zero user friction (no CAPTCHAs)
- 🔒 Privacy-preserving rate limiting (3 comments per day)
- 📦 Minimal dependencies

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your BRASS credentials:

```env
BRASS_SECRET_KEY=your_secret_key
BRASS_ISSUER_PUBKEY=your_issuer_pubkey
```

**Get the issuer public key:**

For self-hosted issuer:
```bash
curl https://your-issuer.workers.dev/pub
# Copy the "Y" value to BRASS_ISSUER_PUBKEY
```

Or use the managed platform at [brassproof.com](https://brassproof.com)

### 3. Run the Server

```bash
npm start
```

Visit: http://localhost:3000

## How It Works

### Backend (`server.js`)

```javascript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY,
  rateLimits: {
    'comment-submission': { maxRequests: 3, windowSeconds: 86400 }
  }
})

app.post('/api/submit-comment', async (req, res) => {
  const { brassToken, comment } = req.body
  
  const result = await verifier.verify(brassToken, {
    origin: req.headers.origin,
    scope: 'comment-submission',
    clientIp: req.ip,
    userAgent: req.headers['user-agent']
  })
  
  if (!result.success) {
    return res.status(429).json({ error: 'Rate limit exceeded' })
  }
  
  // Process the comment...
  res.json({ success: true })
})
```

### Frontend (`public/app.js`)

Uses ES modules from CDN to mint BRASS tokens:

```javascript
import { p256 } from 'https://esm.sh/@noble/curves@1.4.0/p256'
import { sha256 } from 'https://esm.sh/@noble/hashes@1.4.0/sha256'

const brassToken = await getBrassToken(origin, 'comment-submission')

await fetch('/api/submit-comment', {
  method: 'POST',
  body: JSON.stringify({ brassToken, comment })
})
```

## Testing

1. Submit a comment - it works! ✅
2. Submit 2 more comments - still works! ✅
3. Try a 4th comment - rate limited! ❌

The rate limit resets after 24 hours.

## Deployment

### Railway

```bash
railway login
railway init
railway up
```

Add environment variables in Railway dashboard.

### Render

```bash
# Create render.yaml
services:
  - type: web
    name: brass-express-demo
    env: node
    buildCommand: npm install
    startCommand: npm start
```

### Fly.io

```bash
fly launch
fly secrets set BRASS_SECRET_KEY=xxx BRASS_ISSUER_PUBKEY=yyy
fly deploy
```

## Learn More

- **Commercial Platform**: [brassproof.com](https://brassproof.com)
- **Documentation**: [brassproof.com/docs](https://brassproof.com/docs)
- **Self-Hosting Guide**: [SECURITY.md](../../SECURITY.md)
- **npm Package**: [@brassproof/verifier](https://www.npmjs.com/package/@brassproof/verifier)
- **GitHub Repository**: [github.com/tomjwxf/brass-proof-public](https://github.com/tomjwxf/brass-proof-public)
