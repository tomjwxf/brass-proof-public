import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha256'
import { lengthPrefixConcat } from '@shared/length-prefix'
import { Telemetrist } from './telemetry'
import { loadProfile } from './calibrationProfiles'
import type {
  BrassVerifierConfig,
  BrassSpendPayload,
  VerificationResult,
  VerificationContext,
  BrassVerifier,
  RateLimit,
} from './types'

export * from './types'
export { 
  Telemetrist, 
  createTelemetrist, 
  registerThresholdHandler,
  type TelemetryConfig,
  type AlertConfig,
  type AlertSeverity,
  type WebhookConfig,
  type Alert,
  type TelemetryEvent
} from './telemetry'
export { loadProfile, listProfiles, recommendProfile } from './calibrationProfiles'
export type { CalibrationProfile, ProfileOverrides } from './calibrationProfiles'

// Badge is exported separately to avoid forcing React as a runtime dependency
// Import from '@brassproof/verifier/badge' if using React
// export { BrassBadge, vanillaBadgeScript} from './badge'

const DEFAULT_RATE_LIMITS: Record<string, RateLimit> = {
  'comment-submission': { maxRequests: 3, windowSeconds: 86400 },
  'signup': { maxRequests: 5, windowSeconds: 86400 },
  'generic': { maxRequests: 10, windowSeconds: 86400 },
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function b64urlDecode(s: string): Uint8Array {
  // Matches client-side implementation (Node.js path)
  return new Uint8Array(Buffer.from(s, 'base64url'))
}

function Hlabel(label: string, ...parts: (string | Uint8Array)[]): Uint8Array {
  // Matches client-side: sha256(lengthPrefixConcat(['BRASS:${label}:', ...parts]))
  const prefix = `BRASS:${label}:`
  return sha256(lengthPrefixConcat([prefix, ...parts]))
}

function verifyDLEQProof(
  proof: { c: string; r?: string; s?: string },
  g1: InstanceType<typeof p256.ProjectivePoint>,
  h1: InstanceType<typeof p256.ProjectivePoint>,
  g2: InstanceType<typeof p256.ProjectivePoint>,
  h2: InstanceType<typeof p256.ProjectivePoint>,
  label: string,
  bind: Uint8Array,
  useConstantA2: boolean = false
): boolean {
  try {
    // Decode base64url-encoded proof fields
    // Support both {c, r} (client proof) and {c, s} (issuer proof)
    const c = BigInt('0x' + bytesToHex(b64urlDecode(proof.c)))
    const responseField = proof.r || proof.s
    if (!responseField) {
      throw new Error('Proof must have either r or s field')
    }
    const r = BigInt('0x' + bytesToHex(b64urlDecode(responseField)))

    // Reconstruct A1: A1 = g1^r * h1^c
    const A1 = g1.multiply(r).add(h1.multiply(c))
    
    // Client proof: A2 = G (constant) - see brass-strict-client.js line 192
    // Issuer proof: A2 = g2^r * h2^c (normal DLEQ)
    const A2 = useConstantA2 ? g2 : g2.multiply(r).add(h2.multiply(c))

    // Construct challenge using length-prefixed encoding (matches client)
    // Format: length-prefixed concatenation of [BRASS:{label}:, g1, h1, g2, h2, A1, A2, bind]
    // Client line 72-82: lengthPrefixConcat([`BRASS:${label}:`, g1, h1, g2, h2, A1, A2, bind])
    const challengeData = lengthPrefixConcat([
      `BRASS:${label}:`,
      g1.toRawBytes(true),
      h1.toRawBytes(true),
      g2.toRawBytes(true),
      h2.toRawBytes(true),
      A1.toRawBytes(true),
      A2.toRawBytes(true),
      bind
    ])
    
    const hash = sha256(challengeData)
    const cPrime = BigInt('0x' + bytesToHex(hash)) % p256.CURVE.n

    return c === cPrime
  } catch (error) {
    console.error('DLEQ verification error:', error)
    return false
  }
}

async function checkRateLimit(
  tokenHash: string,
  scope: string,
  config: BrassVerifierConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const limits = config.rateLimits || DEFAULT_RATE_LIMITS
  const limit = limits[scope] || limits['generic']

  if (!config.kvNamespace) {
    console.warn('No KV namespace provided - rate limiting disabled')
    return { allowed: true, remaining: limit.maxRequests - 1, resetAt: Date.now() + limit.windowSeconds * 1000 }
  }

  const key = `rate:${tokenHash}:${scope}`
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - (now % limit.windowSeconds)
  const windowKey = `${key}:${windowStart}`

  try {
    const currentCount = await config.kvNamespace.get(windowKey)
    const count = currentCount ? parseInt(currentCount, 10) : 0

    if (count >= limit.maxRequests) {
      const resetAt = (windowStart + limit.windowSeconds) * 1000
      return { allowed: false, remaining: 0, resetAt }
    }

    await config.kvNamespace.put(
      windowKey,
      String(count + 1),
      { expirationTtl: limit.windowSeconds }
    )

    const resetAt = (windowStart + limit.windowSeconds) * 1000
    return { allowed: true, remaining: limit.maxRequests - count - 1, resetAt }
  } catch (error) {
    console.error('Rate limit check error:', error)
    throw new Error('Failed to check rate limit')
  }
}

async function checkReplayProtection(
  idempotencyKey: string,
  config: BrassVerifierConfig
): Promise<boolean> {
  if (!config.kvNamespace) {
    console.warn('No KV namespace provided - replay protection disabled')
    return true
  }

  const key = `replay:${idempotencyKey}`
  const replayWindow = config.replayWindowSeconds || 3600

  try {
    const existing = await config.kvNamespace.get(key)
    if (existing) {
      return false
    }

    await config.kvNamespace.put(key, '1', { expirationTtl: replayWindow })
    return true
  } catch (error) {
    console.error('Replay protection error:', error)
    throw new Error('Failed to check replay protection')
  }
}

export function createBrassVerifier(config: BrassVerifierConfig): BrassVerifier {
  if (!config.secretKey) {
    throw new Error('secretKey is required')
  }

  // Apply calibration profile if specified
  let effectiveRateLimits = config.rateLimits || DEFAULT_RATE_LIMITS
  let effectiveReplayWindow = config.replayWindowSeconds
  
  if (config.calibrationProfile) {
    try {
      const profile = loadProfile(config.calibrationProfile, config.profileOverrides)
      
      // Convert profile rate limits to verifier format
      effectiveRateLimits = {
        'generic': {
          maxRequests: profile.rateLimit.maxRequests,
          windowSeconds: profile.rateLimit.windowSeconds,
        }
      }
      
      effectiveReplayWindow = profile.tokens.maxAgeSeconds
      
      console.log(
        `[BRASS] Applied calibration profile: "${profile.name}" (${profile.version})\n` +
        `  Description: ${profile.description}\n` +
        `  Rate Limit: ${profile.rateLimit.maxRequests} requests per ${profile.rateLimit.windowSeconds}s\n` +
        `  Token Expiry: ${profile.tokens.maxAgeSeconds}s\n` +
        `  Certification: ${profile.certification || 'community'}`
      )
    } catch (error) {
      console.warn(`[BRASS] Failed to load calibration profile "${config.calibrationProfile}":`, error)
      console.warn('[BRASS] Falling back to default rate limits')
    }
  }
  
  // Create final config with profile-applied settings
  const finalConfig: BrassVerifierConfig = {
    ...config,
    rateLimits: effectiveRateLimits,
    replayWindowSeconds: effectiveReplayWindow
  }

  // Initialize telemetry - OPT-IN by default for privacy-first approach
  // Enabled if: config.telemetry.enabled=true OR BRASS_TELEMETRY_ENABLED=true
  const telemetryConfig = config.telemetry || {}
  const telemetryEnabled = telemetryConfig.enabled === true || 
    (typeof process !== 'undefined' && process.env?.BRASS_TELEMETRY_ENABLED === 'true')
  
  const telemetrist = telemetryEnabled ? new Telemetrist({
    ...telemetryConfig,
    enabled: true,
    endpoint: telemetryConfig.endpoint || (typeof process !== 'undefined' ? process.env?.BRASS_TELEMETRY_ENDPOINT : undefined),
    tenantId: telemetryConfig.tenantId || (typeof process !== 'undefined' ? process.env?.BRASS_TENANT_ID : undefined),
  }) : null

  return {
    async verify(
      payload: BrassSpendPayload,
      context: VerificationContext
    ): Promise<VerificationResult> {
      try {
        const { y, c, d_client, piI, piC, eta, KID, AADr, P, M, Zprime, epoch, http_method, http_path, http_body_hash_b64 } = payload

        // Decode base64url-encoded y field
        // Note: y is a 32-byte hash (Hlabel result), NOT a curve point
        // Client line 175: y = b64u(Hlabel(LABEL_Y, ...))
        const yBytes = b64urlDecode(y)

        // Recompute d_client server-side to prevent forgery
        // Server must provide http_method, http_path, and http_body_hash_b64
        if (!http_method || !http_path || !http_body_hash_b64) {
          return { success: false, error: 'Server must provide HTTP context (http_method, http_path, http_body_hash_b64)' }
        }

        const bodyHashBytes = b64urlDecode(http_body_hash_b64)
        const d_client_server = Hlabel('HTTP_CTX_v1', http_method, http_path, bodyHashBytes)
        
        // Verify client-provided d_client matches server-computed value
        const d_client_bytes = b64urlDecode(d_client)
        const d_client_server_hex = bytesToHex(d_client_server)
        const d_client_payload_hex = bytesToHex(d_client_bytes)
        
        if (d_client_server_hex !== d_client_payload_hex) {
          return { success: false, error: 'HTTP request binding mismatch: d_client forgery detected' }
        }

        const issuerPublicKey = finalConfig.issuerPublicKey
        if (!issuerPublicKey) {
          return { success: false, error: 'Issuer public key not configured' }
        }

        const Y = p256.ProjectivePoint.fromHex(hexToBytes(issuerPublicKey))

        // Decode base64url curve points from payload (client sends these pre-computed)
        const PBytes = b64urlDecode(P)
        const PPoint = p256.ProjectivePoint.fromHex(PBytes)
        if (!PPoint) {
          return { success: false, error: 'Invalid P point' }
        }

        const MBytes = b64urlDecode(M)
        const MPoint = p256.ProjectivePoint.fromHex(MBytes)
        if (!MPoint) {
          return { success: false, error: 'Invalid client commitment M' }
        }

        const ZprimeBytes = b64urlDecode(Zprime)
        const ZprimePoint = p256.ProjectivePoint.fromHex(ZprimeBytes)
        if (!ZprimePoint) {
          return { success: false, error: 'Invalid issuer response Z\'' }
        }

        // Construct binder for client DLEQ proof using length-prefixed encoding
        // Note: d_client_bytes already decoded above (line 266) for verification
        // Must match client-side: H('BRASS_BIND_v1', b64ud(y), b64ud(c), d_client, utf8(AADr), utf8(KID), b64ud(eta))
        // Use server-recomputed d_client (not client-provided) to prevent forgery
        const yBytesForBind = b64urlDecode(y)
        const cBytesForBind = b64urlDecode(c)
        const aadrBytesForBind = new TextEncoder().encode(AADr)
        const kidBytesForBind = new TextEncoder().encode(KID)
        const etaBytesForBind = b64urlDecode(eta)
        
        // Extract and validate tlsHash from payload (required for TLS channel binding)
        const tlsHashB64 = payload.tlsHash
        if (!tlsHashB64) {
          return { success: false, error: 'Missing tlsHash field (required for TLS channel binding)' }
        }
        const tlsHashBytes = b64urlDecode(tlsHashB64)
        if (tlsHashBytes.length !== 32) {
          return { success: false, error: 'Invalid tlsHash length (must be 32 bytes)' }
        }

        // Must match client-side: H('BRASS_BIND_v1', b64ud(y), b64ud(c), d_client, utf8(AADr), utf8(KID), b64ud(eta), tlsHash)
        const clientBind = sha256(lengthPrefixConcat([
          'BRASS_BIND_v1',
          yBytesForBind,
          cBytesForBind,
          d_client_server,  // Use server-computed value, not d_client_bytes
          aadrBytesForBind,
          kidBytesForBind,
          etaBytesForBind,
          tlsHashBytes  // TLS exporter hash for channel binding
        ]))

        // Issuer proof doesn't use a binder (or uses empty binder)
        // TODO: Verify if issuer proof should have a binder
        const issuerBind = new Uint8Array(0)

        // Issuer DLEQ proof: standard proof with computed A2
        const issuerProofValid = verifyDLEQProof(
          piI,
          p256.ProjectivePoint.BASE,
          Y,
          PPoint,
          ZprimePoint,
          'issuer',
          issuerBind,
          false  // Compute A2 normally for issuer proof
        )

        if (!issuerProofValid) {
          return { success: false, error: 'Issuer DLEQ proof verification failed' }
        }

        // Client DLEQ proof: g1=P, h1=M, g2=G (BASE), h2=G (BASE), A2=G (constant)
        // Matches client line 192: dleqChallenge({ label, g1: P, h1: M, g2: G, h2: G, A1, A2: G, bind })
        const G = p256.ProjectivePoint.BASE
        const clientProofValid = verifyDLEQProof(
          piC,
          PPoint, // g1 = P
          MPoint, // h1 = M
          G,      // g2 = BASE
          G,      // h2 = BASE
          'OPRF_METERING_DLEQ_v1',  // Matches BRASS_CONFIG.LABEL_DLEQ
          clientBind,
          true    // Use constant A2=G for client proof (matches client line 192)
        )

        if (!clientProofValid) {
          return { success: false, error: 'Client DLEQ proof verification failed' }
        }

        const idempotencyKey = `${y}:${c}`
        const replayAllowed = await checkReplayProtection(idempotencyKey, finalConfig)
        if (!replayAllowed) {
          return { success: false, error: 'Token already used (replay detected)' }
        }

        const tokenHash = bytesToHex(sha256(yBytes))
        const rateLimit = await checkRateLimit(tokenHash, context.scope || 'generic', finalConfig)

        if (!rateLimit.allowed) {
          return {
            success: false,
            error: 'Rate limit exceeded',
            remaining: rateLimit.remaining,
            resetAt: rateLimit.resetAt,
          }
        }

        // Track successful verification in telemetry
        if (telemetrist) {
          await telemetrist.increment(context.scope || 'generic')
        }

        return {
          success: true,
          remaining: rateLimit.remaining,
          resetAt: rateLimit.resetAt,
          metadata: {
            scope: context.scope,
            epoch,
          },
        }
      } catch (error) {
        console.error('Verification error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown verification error',
        }
      }
    },
  }
}

export default createBrassVerifier
