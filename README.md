# BRASS Proof

**Privacy-Preserving Rate Limiting for APIs, SaaS, AI Endpoints, and Agents**

Stop abuse and enforce fair usage without CAPTCHAs, cookies, or tracking.

[![npm](https://img.shields.io/npm/v/@brassproof/verifier)](https://www.npmjs.com/package/@brassproof/verifier)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## 🎯 What is BRASS?

BRASS is an open-source rate limiting platform built on cryptographic privacy.

**Deployment Options:**
- 🏠 **Self-Hosted**: Run your own issuer and verifier (MIT licensed)
- ☁️ **Managed Service**: Production-ready at [brassproof.com](https://brassproof.com)

## 📦 Packages

| Package | Description |
|---------|-------------|
| [@brassproof/verifier](./packages/brass-verifier/) | Core SDK |
| [@brassproof/nextjs](./packages/brass-nextjs/) | Next.js integration |
| [@brassproof/cloudflare](./packages/brass-cloudflare/) | Cloudflare Workers |

## 🚀 Quick Start

\`\`\`bash
npm install @brassproof/verifier
\`\`\`

See [full documentation](https://brassproof.com/docs).

## 🏗️ Repository Structure

\`\`\`
brass-proof-public/
├── packages/          # NPM packages
├── examples/          # Integration examples
├── worker/            # Cloudflare Workers (self-host)
└── docs/              # Documentation
\`\`\`

## 📄 License

MIT License - see [LICENSE](./LICENSE).

## 🔗 Links

- **Website**: https://brassproof.com
- **Documentation**: https://brassproof.com/docs
- **Support**: tommy@brassproof.com

**Built with ❤️ by the BRASS team**
