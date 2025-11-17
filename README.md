# BRASS Proof

**Privacy-Preserving Rate Limiting for APIs, SaaS, AI Endpoints, and Agents**

Stop abuse and enforce fair usage without CAPTCHAs, cookies, or tracking. BRASS uses cryptographic blinded tokens to provide privacy-first rate limiting that's invisible to users and safe for AI agents.

[![npm](https://img.shields.io/npm/v/@brassproof/verifier)](https://www.npmjs.com/package/@brassproof/verifier)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🎯 What is BRASS?

BRASS is an open-source rate limiting platform built on cryptographic privacy:

- **For API providers:** Meter and rate-limit usage without tracking individual users
- **For SaaS apps:** Enforce fair use policies on comment systems, signups, and AI features
- **For AI agents:** Rate limiting that respects agent autonomy without behavioral fingerprinting
- **For privacy advocates:** Self-hostable, auditable, and CAPTCHA-free

**Key Metric:** Protected Requests — any request that passes through BRASS verification

**Deployment Options:**
- 🏠 **Self-Hosted:** Run your own issuer and verifier (MIT licensed, full control)
- ☁️ **Managed Service (GA):** Production-ready platform at [brassproof.com](https://brassproof.com)
  - ✅ Dashboard, billing, and monitoring **generally available**
  - 🔜 Enhanced automation features in **private beta**

---

## 🚀 Quick Start

### Try the Live Demo

**[View Live Demo →](https://demo.brassproof.com)** *(Deploy instructions below)*

### Install via npm

```bash
# Core verifier SDK
npm install @brassproof/verifier

# Next.js integration
npm install @brassproof/nextjs

# Cloudflare Workers integration
npm install @brassproof/cloudflare

# CLI scaffolder
npx @brassproof/create
```

### Managed Service (Generally Available)

Production-ready managed hosting is **now available**:

**[📖 Full Documentation →](https://brassproof.com/docs)**  
**[💳 Pricing & Plans →](https://brassproof.com/pricing)**  
**[🚀 Get Started →](https://brassproof.com/dashboard)**

---

## 📦 Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@brassproof/verifier](./packages/brass-verifier/) | Core cryptographic verifier SDK | [![npm](https://img.shields.io/npm/v/@brassproof/verifier)](https://www.npmjs.com/package/@brassproof/verifier) |
| [@brassproof/nextjs](./packages/brass-nextjs/) | React hooks + API middleware | [![npm](https://img.shields.io/npm/v/@brassproof/nextjs)](https://www.npmjs.com/package/@brassproof/nextjs) |
| [@brassproof/cloudflare](./packages/brass-cloudflare/) | Cloudflare Workers helpers | [![npm](https://img.shields.io/npm/v/@brassproof/cloudflare)](https://www.npmjs.com/package/@brassproof/cloudflare) |
| @brassproof/create | CLI scaffolding tool | [![npm](https://img.shields.io/npm/v/@brassproof/create)](https://www.npmjs.com/package/@brassproof/create) |

---

## 🎯 Integration Examples

### 1. Next.js App (Full Template)

**[examples/nextjs-app](./examples/nextjs-app/)** - Production-ready Next.js template

```bash
# Use the template
npx @brassproof/create next-app my-app

# Or clone this repo
git clone https://github.com/tomjwxf/brass-proof-public.git
cd brass-proof-public/examples/nextjs-app
npm install
npm run dev
```

**[📖 View Template README](./examples/nextjs-app/README.md)**

---

### 2. Express.js App

**[examples/express-app](./examples/express-app/)** - Minimal Express server with BRASS

```bash
cd examples/express-app
npm install
npm start
```

**Features:**
- ✅ Single BRASS-protected POST endpoint
- ✅ Static file serving for frontend
- ✅ ES modules & modern JavaScript
- ✅ ~150 lines of code total

**[📖 View Express README](./examples/express-app/README.md)**

---

### 3. Vanilla HTML/JavaScript

**[examples/vanilla-html](./examples/vanilla-html/)** - Zero dependencies, single HTML file

```bash
cd examples/vanilla-html
open index.html  # Or use any static server
```

**Features:**
- ✅ No build tools required
- ✅ No npm packages
- ✅ Copy-paste into any website
- ✅ Complete BRASS implementation in ~350 lines

**[📖 View Vanilla README](./examples/vanilla-html/README.md)**

---

## 🛠️ How It Works

### Privacy Mode: Standard (Available Today)

BRASS Standard uses **epoch-bound passes** (cryptographic tokens valid for a time window) with blinded token protocols:

1. **Client requests a token** from the issuer (blinded to preserve privacy)
2. **Issuer signs the token** without seeing the underlying data
3. **Client unblinds** and presents the token to your verifier
4. **Verifier enforces rate limits** per-scope, per-origin using deterministic counters

```javascript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY,
  rateLimits: {
    'api-requests': { maxRequests: 100, windowSeconds: 86400 }
  }
})

app.post('/api/endpoint', async (req, res) => {
  const result = await verifier.verify(req.body.brassToken, {
    origin: req.headers.origin,
    scope: 'api-requests'
  })
  
  if (!result.success) {
    return res.status(429).json({ error: 'Rate limit exceeded' })
  }
  
  // Process protected request...
})
```

### Privacy Mode: Strict (Roadmap)

Full issuer-blind protocol with zero-knowledge proofs. The issuer cannot link:
- Token issuance to token spending
- Multiple requests from the same client
- Any user-identifying information

**Status:** Architectural design complete, implementation in progress  
**Timeline:** Post-v1 launch

---

## 🔐 Privacy Guarantees

| Feature | How BRASS Does It |
|---------|-------------------|
| **No Tracking** | Blinded tokens prevent issuer from linking issuance to spending |
| **No CAPTCHAs** | Cryptographic proofs replace visual puzzles |
| **No Cookies** | Stateless verification via cryptographic commitments |
| **No IP Logging** | Rate limits enforced via token scoping, not IP addresses |
| **Agent-Safe** | Works with AI agents, robots, and automation without fingerprinting |
| **Self-Hostable** | Run your own issuer and verifier - no third-party dependencies |

---

## 📊 Comparison

| Solution | User Friction | Privacy | Accessibility | Agents/Robots | Self-Hostable |
|----------|--------------|---------|---------------|---------------|---------------|
| **BRASS** | ✅ Zero | ✅ Full | ✅ Perfect | ✅ Excellent | ✅ Yes |
| reCAPTCHA | ❌ High | ❌ Poor | ❌ Poor | ❌ Breaks | ❌ No |
| Turnstile | 🟡 Low-Medium | 🟡 Better | ✅ Good | 🟡 Limited | ❌ No |

---

## 🏗️ Self-Hosting Guide

### Architecture Options

**Option 1: Fully Self-Hosted (Recommended for Privacy)**
- Run your own issuer + verifier
- Full control over all data
- Zero external dependencies
- See [SECURITY.md](./SECURITY.md) for setup instructions

**Option 2: Managed Issuer + Self-Hosted Verifier**
- Use the managed issuer at [brassproof.com](https://brassproof.com)
- Run your own verifier for rate limiting
- Hybrid trust model

**Option 3: Fully Managed**
- Use [brassproof.com](https://brassproof.com) for complete hosting
- Dashboard, monitoring, and billing included
- See [Pricing](https://brassproof.com/pricing)

### Quick Self-Host with Cloudflare Workers

```bash
# Deploy issuer
cd worker/
wrangler deploy issuer-cloudflare.js

# Deploy verifier
wrangler deploy verifier-cloudflare.js

# Set secrets
wrangler secret put BRASS_SECRET_KEY
```

**[📖 Complete Self-Hosting Guide →](./SECURITY.md)**

---

## 🚀 Deployment

### Deploy Next.js Template to Vercel

**Quick Deploy:**

1. Push to GitHub
2. Connect Vercel to your repository
3. Point to the `examples/nextjs-app` directory
4. Set environment variables:
   - `BRASS_SECRET_KEY`
   - `BRASS_ISSUER_PUBKEY`
5. Deploy!

Your live demo will be at: `https://your-app.vercel.app`

---

## 🏗️ Repository Structure

```
brass-proof-public/
├── packages/
│   ├── brass-verifier/       # Core SDK (@brassproof/verifier)
│   ├── brass-nextjs/          # Next.js integration (@brassproof/nextjs)
│   └── brass-cloudflare/      # Cloudflare Workers (@brassproof/cloudflare)
├── examples/
│   ├── nextjs-app/            # Next.js template (production-ready)
│   ├── express-app/           # Express.js example
│   └── vanilla-html/          # Single HTML file example
├── worker/
│   ├── issuer-cloudflare.js   # Cloudflare issuer worker (self-host reference)
│   └── verifier-cloudflare.js # Cloudflare verifier worker (self-host reference)
├── README.md
├── LICENSE
├── CONTRIBUTING.md
└── SECURITY.md
```

**Note:** This is the open-source distribution. The managed service dashboard is proprietary and hosted separately.

---

## 📚 Documentation

### Open Source

- **[Package READMEs](./packages/)** - Individual package documentation
- **[Example READMEs](./examples/)** - Integration examples
- **[SECURITY.md](./SECURITY.md)** - Self-hosting security guide
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Development guidelines

### Commercial Platform

- **[Full Documentation](https://brassproof.com/docs)** - Complete API reference
- **[Quickstart Guides](https://brassproof.com/docs#quickstart)** - Get started in 5 minutes
- **[Pricing](https://brassproof.com/pricing)** - Managed service plans

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Development setup
- Package development
- Testing procedures
- Publishing workflow
- Code style guidelines
- Pull request process

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

The core BRASS protocol and SDK are open source. The managed service dashboard and commercial features are proprietary.

---

## 🌟 Why BRASS?

**Traditional CAPTCHAs are broken:**
- ❌ Frustrate users (especially on mobile)
- ❌ Track behavior and sell data
- ❌ Fail accessibility standards
- ❌ Break automation and AI agents
- ❌ Lock you into proprietary services

**BRASS is better:**
- ✅ Invisible to users
- ✅ Privacy-preserving by design
- ✅ Accessible to everyone
- ✅ Agent-safe (works with robots and AI)
- ✅ Self-hostable and open-source

---

## 🔗 Links

- **Commercial Platform**: https://brassproof.com
- **Documentation**: https://brassproof.com/docs
- **npm Organization**: https://www.npmjs.com/org/brassproof
- **GitHub Repository**: https://github.com/tomjwxf/brass-proof-public

---

## 💬 Support

- **Open Source Issues**: [GitHub Issues](https://github.com/tomjwxf/brass-proof-public/issues)
- **Open Source Discussions**: [GitHub Discussions](https://github.com/tomjwxf/brass-proof-public/discussions)
- **Commercial Support**: support@brassproof.com

---

## 📋 Feature Availability

**Current Version:** v1.0 (Generally Available)

### Open Source (Self-Hosted)

| Feature | Status | Description |
|---------|--------|-------------|
| Core Verifier SDK | ✅ **GA** | Full cryptographic verification engine |
| Calibration Profiles | ✅ **GA** | Battle-tested rate limit templates |
| Privacy Badge | ✅ **GA** | Embeddable "Protected by BRASS" widget |
| Telemetry (Opt-in) | ✅ **GA** | Usage tracking and webhook alerts |
| Next.js Integration | ✅ **GA** | React hooks + API middleware |
| Cloudflare Workers | ✅ **GA** | Worker deployment helpers |

### Managed Service ([brassproof.com](https://brassproof.com))

| Feature | Status | Description |
|---------|--------|-------------|
| Dashboard & Billing | ✅ **GA** | Project management, API keys, usage monitoring |
| Hosted Infrastructure | ✅ **GA** | Issuer/verifier workers with auto-scaling |
| Usage-Based Pricing | ✅ **GA** | Multiple tiers with flexible limits |
| Professional Support | ✅ **GA** | Email and chat support |
| Dynamic Calibration | 🔜 **Private Beta** | ML-powered profile recommendations |
| Alert Integrations | 🔜 **Private Beta** | Managed Slack/PagerDuty/SMS alerts |
| Shared Intel Exchange | 📋 **Planned** | Curated threat intelligence feeds |

**Future Roadmap:**
- 🔄 Strict issuer-blind mode with zero-knowledge proofs (In development)
- 📋 Reputation and trust scoring (Planned)
- 📋 IETF standardization track (Under consideration)

See [ROADMAP.md](./packages/brass-verifier/ROADMAP.md) for details.

Stop abuse without sacrificing privacy. Try BRASS today!
