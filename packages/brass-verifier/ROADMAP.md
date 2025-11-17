# BRASS Proof Roadmap

> **Last Updated:** November 2025

This document outlines the development roadmap for BRASS Proof, a privacy-first rate limiting platform.

## 🎯 Vision

Build a privacy-first rate limiting network where the **managed service** provides intelligence and automation **on top of** the fully functional open-source package. Self-hosters get battle-tested configurations, managed customers get enhanced automation powered by aggregated telemetry.

---

## ✅ Phase 1: Foundation (Shipped)

**Status:** ✅ Generally Available

**Features:**
- ✅ Core verifier package (`@brassproof/verifier`)
- ✅ Privacy badge component
- ✅ Telemetry infrastructure (opt-in)
- ✅ Badge component (React + vanilla JS)
- ✅ Next.js and Cloudflare Workers integrations

**Outcome:** Production-ready open-source package with all essential features.

---

## 🚀 Phase 2: Calibration Marketplace (Available Now)

**Status:** ✅ Available for Self-Hosting

**Features:**
- ✅ Curated security profiles (comments, signup, API, e-commerce)
- ✅ Profile loading with override support
- ✅ `listProfiles()` and `recommendProfile()` utilities
- 🔜 Community profile contributions (GitHub PRs)
- 🔜 Profile versioning and deprecation system

**OSS Value:** Self-hosters get battle-tested rate limit configurations without trial-and-error.

**Managed Value:** Enhanced automation and dynamic recommendations.

**Example:**
```typescript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY,
  calibrationProfile: 'ecommerce', // Instant config for checkout flows
  profileOverrides: {
    rateLimit: { maxRequests: 15 } // Fine-tune as needed
  }
})
```

---

## 📊 Phase 3: Telemetry Alerts (In Progress)

**Status:** 🚧 Infrastructure Available, Enhanced Features Coming Soon

**Features:**
- ✅ Alert infrastructure (webhooks, Slack, email)
- ✅ Severity gating (critical-only by default)
- ✅ Rate limiting (5 alerts/day cap)
- ✅ Dry run mode for testing
- 🔜 Pre-configured integrations for managed service
- 🔜 SMS alerts via managed service
- 🔜 ML-powered anomaly detection

**OSS Value:** Self-hosters can configure webhook alerts with their own infrastructure.

**Managed Value:** Pre-built integrations and smart alerting powered by machine learning.

**Example:**
```typescript
const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY,
  telemetry: {
    enabled: true,
    alerts: {
      webhooks: [{
        url: 'https://your-alerting-service.com/hook',
        secret: process.env.WEBHOOK_SECRET
      }],
      severities: ['critical'], // Only DDoS/massive abuse
      maxAlertsPerDay: 5,
      dryRun: true // Test config without sending
    }
  }
})
```

---

## 🛡️ Phase 4: Shared Abuse Intel Exchange (Planned)

**Status:** 🔮 Coming Soon

**Features:**
- 🔜 Hashed abuse indicator publishing
- 🔜 Curated blocklist distribution
- 🔜 Contribution validation pipeline
- 🔜 Privacy-preserving indicator sharing

**OSS Value:** Self-hosters can publish indicators to their own intel feeds.

**Managed Value:** Curated, validated blocklists from thousands of sites → instant protection from known bad actors.

**Privacy Guarantees:**
- SHA-256 hashing prevents raw token exposure
- Tenant-specific salts prevent cross-tenant correlation
- No PII collected (IP addresses are hashed)
- Opt-in only (disabled by default)

---

## 🎁 What's Available Today (Self-Hosters)

If you deploy BRASS Proof today, you get:

1. ✅ **Full verifier package** - Production-ready cryptographic verification
2. ✅ **Calibration profiles** - 4 curated rate limit templates (comments, signup, API, e-commerce)
3. ✅ **Privacy badge** - Embeddable "Protected by BRASS Proof" widget
4. ✅ **Telemetry infrastructure** - Opt-in usage tracking (disabled by default)
5. ✅ **Alert webhooks** - Configure your own Slack/PagerDuty/custom alerts
6. ✅ **Unlimited free usage** - No quotas, no API keys, full source code

**Managed service adds:**
- Dashboard with real-time analytics
- Hosted issuer and verifier infrastructure
- Usage-based billing with multiple tiers
- Monitoring, auto-scaling, and SLA guarantees
- Pre-built integrations and managed alerts

---

## 🚀 Managed Service

The BRASS managed service is **now available** at [brassproof.com](https://brassproof.com).

**Benefits:**
- ✅ Hosted infrastructure (no deployment needed)
- ✅ Real-time usage analytics dashboard
- ✅ Multiple subscription tiers for different scales
- ✅ Professional support
- ✅ Automatic scaling and monitoring

Visit [brassproof.com/pricing](https://brassproof.com/pricing) for current plans and pricing.

---

## 🤝 Contributing

We welcome community contributions to calibration profiles!

**How to contribute a profile:**
1. Fork the repo
2. Add profile JSON to `packages/brass-verifier/profiles/`
3. Include metadata: description, tested scenarios, warnings
4. Open PR with rationale and real-world validation data
5. BRASS team reviews and tests
6. Merged profiles get "brass-verified" certification

**Profile Certification Levels:**
- `brass-verified` - Tested by BRASS team with aggregated telemetry
- `community` - Contributed by community, not yet verified
- `experimental` - Bleeding-edge configurations, use with caution

---

## 📞 Contact

- **Managed Service:** [brassproof.com](https://brassproof.com)
- **Technical Support:** support@brassproof.com (managed customers)
- **Open Source Support:** [GitHub Issues](https://github.com/brassproof/brass-proof/issues)
- **Sales:** sales@brassproof.com

---

*Built with ❤️ by the BRASS Security Team*
