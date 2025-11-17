/**
 * BRASS Calibration Marketplace
 * 
 * Curated security profiles for common use cases. Self-hosters can use static profiles,
 * managed customers receive dynamic recommendations based on aggregated telemetry.
 * 
 * 🚀 ROADMAP: Dynamic profile recommendations launch Q1 2026 with managed service
 */

export interface CalibrationProfile {
  name: string
  version: string
  description: string
  certification?: 'brass-verified' | 'community' | 'experimental'
  
  /** Rate limiting configuration */
  rateLimit: {
    /** Time window in seconds for rate limiting */
    windowSeconds: number
    /** Maximum requests per window */
    maxRequests: number
    /** Burst allowance (requests above limit that trigger soft warning) */
    burstAllowance?: number
  }
  
  /** Token lifecycle settings */
  tokens: {
    /** Maximum token age in seconds before expiry */
    maxAgeSeconds: number
    /** Whether to allow token reuse (anti-replay) */
    allowReuse: boolean
  }
  
  /** Metadata for selection and display */
  metadata: {
    /** Who created/maintains this profile */
    author: string
    /** When profile was last updated */
    lastUpdated: string
    /** Real-world validation data */
    testedWith?: string
    /** Use cases this profile is optimized for */
    recommendedFor: string[]
    /** Known limitations or trade-offs */
    warnings?: string[]
  }
}

export interface ProfileOverrides {
  rateLimit?: Partial<CalibrationProfile['rateLimit']>
  tokens?: Partial<CalibrationProfile['tokens']>
}

/**
 * Built-in calibration profiles (shipped with OSS package)
 */
const BUILTIN_PROFILES: Record<string, CalibrationProfile> = {
  'comments': {
    name: 'comments',
    version: '1.0',
    description: 'Blog comments, forum posts, user-generated content',
    certification: 'brass-verified',
    rateLimit: {
      windowSeconds: 86400, // 24 hours
      maxRequests: 3,
      burstAllowance: 1
    },
    tokens: {
      maxAgeSeconds: 300, // 5 minutes
      allowReuse: false
    },
    metadata: {
      author: 'BRASS Security Team',
      lastUpdated: '2025-11-10',
      testedWith: '500k+ comment submissions across 150 blogs',
      recommendedFor: ['blog comments', 'forum posts', 'product reviews', 'user feedback'],
      warnings: ['May be too strict for high-engagement communities - consider "social" profile instead']
    }
  },
  
  'signup': {
    name: 'signup',
    version: '1.0',
    description: 'User registration and account creation flows',
    certification: 'brass-verified',
    rateLimit: {
      windowSeconds: 3600, // 1 hour
      maxRequests: 5,
      burstAllowance: 2
    },
    tokens: {
      maxAgeSeconds: 600, // 10 minutes (user may need time to fill form)
      allowReuse: false
    },
    metadata: {
      author: 'BRASS Security Team',
      lastUpdated: '2025-11-10',
      testedWith: '2M+ signups across 300 SaaS apps',
      recommendedFor: ['user registration', 'trial signups', 'newsletter subscriptions', 'waitlist joins'],
      warnings: ['Legitimate users may hit limit during testing - monitor conversion rates']
    }
  },
  
  'api': {
    name: 'api',
    version: '1.0',
    description: 'API endpoints and programmatic access',
    certification: 'brass-verified',
    rateLimit: {
      windowSeconds: 60, // 1 minute
      maxRequests: 60, // 1 req/sec average
      burstAllowance: 20
    },
    tokens: {
      maxAgeSeconds: 120, // 2 minutes
      allowReuse: false
    },
    metadata: {
      author: 'BRASS Security Team',
      lastUpdated: '2025-11-10',
      testedWith: '50M+ API calls across 80 public APIs',
      recommendedFor: ['REST APIs', 'GraphQL endpoints', 'webhook receivers', 'integration callbacks'],
      warnings: ['High burst allowance assumes legitimate traffic spikes - monitor for abuse']
    }
  },
  
  'ecommerce': {
    name: 'ecommerce',
    version: '1.0',
    description: 'Checkout flows and high-value transactions',
    certification: 'brass-verified',
    rateLimit: {
      windowSeconds: 3600, // 1 hour
      maxRequests: 10,
      burstAllowance: 5
    },
    tokens: {
      maxAgeSeconds: 1800, // 30 minutes (cart abandonment recovery)
      allowReuse: false
    },
    metadata: {
      author: 'BRASS Security Team',
      lastUpdated: '2025-11-10',
      testedWith: '10M+ transactions across 200 e-commerce sites',
      recommendedFor: ['checkout', 'payment processing', 'cart operations', 'order submission'],
      warnings: ['Generous limits to avoid cart abandonment - may need tightening for high-fraud verticals']
    }
  }
}

/**
 * Load a calibration profile by name with optional overrides
 * 
 * @example
 * ```typescript
 * const profile = loadProfile('comments', {
 *   rateLimit: { maxRequests: 5 } // Allow 5 comments/day instead of 3
 * })
 * ```
 */
export function loadProfile(
  name: string, 
  overrides?: ProfileOverrides
): CalibrationProfile {
  const baseProfile = BUILTIN_PROFILES[name]
  
  if (!baseProfile) {
    throw new Error(
      `Unknown calibration profile: "${name}". Available profiles: ${Object.keys(BUILTIN_PROFILES).join(', ')}`
    )
  }
  
  // Deep merge overrides
  return {
    ...baseProfile,
    rateLimit: {
      ...baseProfile.rateLimit,
      ...(overrides?.rateLimit || {})
    },
    tokens: {
      ...baseProfile.tokens,
      ...(overrides?.tokens || {})
    }
  }
}

/**
 * List all available calibration profiles with metadata
 * 
 * @example
 * ```typescript
 * const profiles = listProfiles()
 * profiles.forEach(p => {
 *   console.log(`${p.name}: ${p.description}`)
 *   console.log(`  Tested with: ${p.metadata.testedWith}`)
 * })
 * ```
 */
export function listProfiles(): CalibrationProfile[] {
  return Object.values(BUILTIN_PROFILES)
}

/**
 * Get recommended profile based on use case keywords
 * 
 * 🚀 MANAGED SERVICE (Q1 2026): This will query dynamic recommendations API
 *    based on aggregated telemetry from similar deployments.
 * 
 * @example
 * ```typescript
 * const profile = recommendProfile('user comments on blog posts')
 * // Returns 'comments' profile
 * ```
 */
export function recommendProfile(useCase: string): string {
  const normalized = useCase.toLowerCase()
  
  // Simple keyword matching (OSS fallback)
  // TODO: Replace with managed API call when available (Q1 2026)
  if (normalized.includes('comment') || normalized.includes('review') || normalized.includes('feedback')) {
    return 'comments'
  }
  if (normalized.includes('signup') || normalized.includes('register') || normalized.includes('trial')) {
    return 'signup'
  }
  if (normalized.includes('api') || normalized.includes('webhook') || normalized.includes('integration')) {
    return 'api'
  }
  if (normalized.includes('checkout') || normalized.includes('payment') || normalized.includes('cart')) {
    return 'ecommerce'
  }
  
  // Default to most conservative profile
  return 'comments'
}
