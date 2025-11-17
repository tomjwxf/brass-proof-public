export interface BrassSpendPayload {
  // Matches client buildSpend return (line 197-209) + server additions
  KID: string       // token.KID (string)
  AADr: string      // token.AADr (string)
  origin: string    // token.origin (string)
  epoch: number     // token.epoch (number)
  y: string         // base64url
  eta: string       // base64url
  c: string         // base64url
  Z: string         // base64url (token.Z)
  Zprime: string    // base64url (token.Zprime)
  P: string         // base64url (token.P)
  M: string         // base64url (token.M)
  piI: {
    c: string       // base64url
    s: string       // base64url
  }
  piC: {
    c: string       // base64url
    r: string       // base64url
  }
  d_client: string           // base64url from client
  http_method?: string       // Added by server (e.g., 'POST')
  http_path?: string         // Added by server (e.g., '/api/submit-pro')
  http_body_hash_b64?: string // Added by server (base64url body hash)
  tlsHash?: string           // TLS channel binding (base64url-encoded hash)
}

// Re-export telemetry types from telemetry.ts to avoid duplication
export type { TelemetryConfig, AlertConfig, AlertSeverity, WebhookConfig, Alert } from './telemetry'

export interface BadgeConfig {
  enabled: boolean
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  linkUrl?: string
  variant?: 'default' | 'minimal' | 'compact'
  theme?: 'light' | 'dark' | 'auto'
}

export interface BrassVerifierConfig {
  secretKey: string
  issuerPublicKey?: string
  issuerUrl?: string
  kvNamespace?: KVNamespace
  rateLimits?: Record<string, RateLimit>
  replayWindowSeconds?: number
  telemetry?: Partial<import('./telemetry').TelemetryConfig>
  badge?: Partial<BadgeConfig>
  /** Calibration profile name (e.g., 'comments', 'signup', 'api', 'ecommerce') */
  calibrationProfile?: string
  /** Override specific profile settings */
  profileOverrides?: {
    rateLimit?: Partial<{ windowSeconds: number; maxRequests: number; burstAllowance?: number }>
    tokens?: Partial<{ maxAgeSeconds: number; allowReuse: boolean }>
  }
}

export interface RateLimit {
  maxRequests: number
  windowSeconds: number
}

export interface VerificationResult {
  success: boolean
  error?: string
  remaining?: number
  resetAt?: number
  metadata?: Record<string, unknown>
}

export interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface BrassVerifier {
  verify(payload: BrassSpendPayload, context: VerificationContext): Promise<VerificationResult>
}

export interface VerificationContext {
  origin: string
  scope: string
  clientIp?: string
  userAgent?: string
  additionalData?: Record<string, unknown>
}
