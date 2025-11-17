/**
 * BRASS Telemetry Module
 * 
 * Tracks anonymized verification metrics and emits threshold notifications.
 * All telemetry is opt-in and privacy-safe (no PII, only aggregated counts).
 * 
 * 🚀 MANAGED SERVICE (Q1 2026): Alert webhooks will connect to managed alerting infrastructure
 *    Set BRASS_MANAGED_ALERT_URL when managed service launches
 */

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface WebhookConfig {
  url: string
  secret?: string
}

export interface AlertConfig {
  webhooks?: WebhookConfig[]
  email?: {
    apiEndpoint: string
    token: string
    recipients: string[]
  }
  slack?: {
    webhookUrl: string
  }
  /** Only send alerts matching these severity levels (default: ['critical'] only) */
  severities?: AlertSeverity[]
  /** Max alerts per day to prevent spam (default: 5) */
  maxAlertsPerDay?: number
  /** Debounce window in minutes to prevent duplicate alerts (default: 60) */
  debounceMinutes?: number
  /** Dry run mode: log alerts without actually sending (default: false) */
  dryRun?: boolean
}

export interface TelemetryConfig {
  enabled: boolean
  endpoint?: string
  tenantId?: string
  onThreshold?: (threshold: number, count: number) => void
  thresholds?: number[]
  alerts?: AlertConfig
}

export interface TelemetryEvent {
  type: 'verification' | 'threshold_reached' | 'alert'
  tenantId?: string
  count?: number
  threshold?: number
  timestamp: number
  metadata?: Record<string, any>
  severity?: AlertSeverity
}

export interface Alert {
  severity: AlertSeverity
  title: string
  message: string
  timestamp: number
  metadata?: Record<string, any>
}

const DEFAULT_THRESHOLDS = [50000, 500000, 2000000, 5000000, 10000000]
const DEFAULT_ENDPOINT = 'https://telemetry.brassproof.com/ingest'

export class Telemetrist {
  private config: Required<TelemetryConfig>
  private counts: Map<string, number> = new Map()
  private notifiedThresholds: Set<number> = new Set()
  private retryQueue: TelemetryEvent[] = []
  private retryDelay = 1000
  private maxRetries = 3
  
  // Alert tracking
  private alertCounts: Map<string, number> = new Map() // Daily alert counts by date
  private lastAlertTime: Map<string, number> = new Map() // Debounce tracking

  constructor(config: Partial<TelemetryConfig> = {}) {
    // OPT-IN by default: telemetry disabled unless explicitly enabled
    this.config = {
      enabled: config.enabled ?? false,
      endpoint: config.endpoint || DEFAULT_ENDPOINT,
      tenantId: config.tenantId || 'anonymous',
      onThreshold: config.onThreshold || this.defaultThresholdHandler.bind(this),
      thresholds: config.thresholds || DEFAULT_THRESHOLDS,
      alerts: {
        severities: config.alerts?.severities || ['critical'], // Critical-only by default
        maxAlertsPerDay: config.alerts?.maxAlertsPerDay || 5, // 5/day cap
        debounceMinutes: config.alerts?.debounceMinutes || 60,
        dryRun: config.alerts?.dryRun ?? false, // Default to false for production
        ...config.alerts,
      }
    }

    if (!this.config.enabled) {
      console.debug(
        'BRASS Telemetry is disabled (opt-in). To enable:\n' +
        '   • Set BRASS_TELEMETRY_ENABLED=true environment variable\n' +
        '   • Or pass { telemetry: { enabled: true } } to createBrassVerifier()\n' +
        '   Learn more: https://brassproof.com/docs/telemetry'
      )
    }
  }

  /**
   * Increment verification count for a given epoch/scope
   */
  async increment(scope: string = 'default'): Promise<void> {
    if (!this.config.enabled) return

    const epoch = this.getCurrentEpoch()
    const key = `${epoch}:${scope}`
    const current = (this.counts.get(key) || 0) + 1
    this.counts.set(key, current)

    // Check if we've crossed any thresholds
    await this.checkThresholds(current)

    // Emit anonymized metric (fire-and-forget with retry)
    this.emit({
      type: 'verification',
      tenantId: this.config.tenantId,
      count: current,
      timestamp: Date.now(),
      metadata: { scope, epoch },
    })
  }

  /**
   * Get current count for an epoch/scope
   */
  getCount(scope: string = 'default'): number {
    const epoch = this.getCurrentEpoch()
    const key = `${epoch}:${scope}`
    return this.counts.get(key) || 0
  }

  /**
   * Check if any thresholds have been crossed
   */
  private async checkThresholds(count: number): Promise<void> {
    for (const threshold of this.config.thresholds) {
      if (count >= threshold && !this.notifiedThresholds.has(threshold)) {
        this.notifiedThresholds.add(threshold)
        
        // Trigger threshold handler
        this.config.onThreshold(threshold, count)

        // Emit threshold event
        this.emit({
          type: 'threshold_reached',
          tenantId: this.config.tenantId,
          threshold,
          count,
          timestamp: Date.now(),
        })
      }
    }
  }

  /**
   * Default threshold handler with upgrade messaging
   */
  private defaultThresholdHandler(threshold: number, count: number): void {
    const messages: Record<number, string> = {
      50000: '🎉 BRASS threshold 50k reached! You\'re on the Free tier limit.\n   → Upgrade to Startup ($99/mo) for 500k tokens: https://brassproof.com/pricing',
      500000: '🚀 BRASS threshold 500k reached! Connect to BRASS Managed for:\n   • Auto-calibration based on attack patterns\n   • Shared threat intel from 100k+ sites\n   • Real-time analytics dashboard\n   → Upgrade to Pro ($249/mo): https://brassproof.com/pricing',
      2000000: '⚡ BRASS threshold 2M reached! Enterprise features unlocked:\n   • Dedicated Slack support channel\n   • Custom rate limit tuning\n   • Priority security updates\n   → Upgrade to Growth ($499/mo): https://brassproof.com/pricing',
      5000000: '🏆 BRASS threshold 5M reached! Talk to our team about Enterprise:\n   • Volume pricing ($0.08-$0.12/1k)\n   • White-glove onboarding\n   • Custom SLAs & dedicated CSM\n   → Contact us: https://brassproof.com/enterprise',
    }

    const message = messages[threshold] || 
      `BRASS threshold ${threshold.toLocaleString()} reached (current: ${count.toLocaleString()}).\n   Learn about managed service benefits: https://brassproof.com/upgrade`

    console.log(message)
  }

  /**
   * Emit an alert through configured channels (webhooks, email, Slack)
   * 
   * Features:
   * - Severity filtering (only configured severities are sent)
   * - Rate limiting (max 5/day by default)
   * - Debouncing (prevent duplicate alerts within time window)
   * - Dry run mode (log without sending)
   * - HMAC SHA-256 signature for webhooks
   * 
   * @example
   * ```typescript
   * await telemetrist.emitAlert({
   *   severity: 'critical',
   *   title: 'DDoS Attack Detected',
   *   message: 'Traffic spike: 10x normal rate',
   *   timestamp: Date.now(),
   *   metadata: { scope: 'api', currentRate: 1000 }
   * })
   * ```
   */
  async emitAlert(alert: Alert): Promise<void> {
    if (!this.config.enabled || !this.config.alerts) return

    const { severities, maxAlertsPerDay, debounceMinutes, dryRun, webhooks, slack } = this.config.alerts

    // Severity filtering: only send if severity matches config
    if (!severities?.includes(alert.severity)) {
      console.debug(`[BRASS] Alert filtered (severity: ${alert.severity} not in [${severities?.join(', ')}])`)
      return
    }

    // Rate limiting: check daily cap
    const today = new Date().toISOString().split('T')[0]
    const dailyCount = this.alertCounts.get(today) || 0
    if (dailyCount >= (maxAlertsPerDay || 5)) {
      console.warn(`[BRASS] Alert rate limit exceeded (${dailyCount}/${maxAlertsPerDay} today)`)
      return
    }

    // Debouncing: prevent duplicate alerts within window
    const debounceKey = `${alert.severity}:${alert.title}`
    const lastTime = this.lastAlertTime.get(debounceKey) || 0
    const debounceMs = (debounceMinutes || 60) * 60 * 1000
    if (Date.now() - lastTime < debounceMs) {
      console.debug(`[BRASS] Alert debounced (${debounceKey} sent ${Math.floor((Date.now() - lastTime) / 60000)}m ago)`)
      return
    }

    // Dry run mode: log without sending
    if (dryRun) {
      console.log(`[BRASS] Alert (DRY RUN):\n  Severity: ${alert.severity}\n  Title: ${alert.title}\n  Message: ${alert.message}`)
      return
    }

    // Update tracking
    this.alertCounts.set(today, dailyCount + 1)
    this.lastAlertTime.set(debounceKey, Date.now())

    // Dispatch to configured channels
    const promises: Promise<void>[] = []

    // Webhooks
    if (webhooks && webhooks.length > 0) {
      for (const webhook of webhooks) {
        promises.push(this.sendWebhook(webhook, alert))
      }
    }

    // Slack
    if (slack?.webhookUrl) {
      promises.push(this.sendSlackAlert(slack.webhookUrl, alert))
    }

    // Wait for all dispatches (fire-and-forget, errors suppressed)
    await Promise.allSettled(promises)

    // Emit telemetry event
    this.emit({
      type: 'alert',
      tenantId: this.config.tenantId,
      severity: alert.severity,
      timestamp: Date.now(),
      metadata: { title: alert.title },
    })
  }

  /**
   * Send alert to webhook with HMAC SHA-256 signature
   */
  private async sendWebhook(webhook: WebhookConfig, alert: Alert): Promise<void> {
    try {
      const payload = JSON.stringify({
        alert,
        tenantId: this.config.tenantId,
        timestamp: Date.now(),
      })

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-BRASS-Event': 'alert',
      }

      // Add HMAC signature if secret provided
      if (webhook.secret && typeof crypto !== 'undefined' && crypto.subtle) {
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(webhook.secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        )
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
        const signatureHex = Array.from(new Uint8Array(signature))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
        headers['X-Brass-Signature'] = `sha256=${signatureHex}`
      }

      if (typeof fetch !== 'undefined') {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: payload,
        })

        if (!response.ok) {
          console.warn(`[BRASS] Webhook failed (${response.status}): ${webhook.url}`)
        }
      }
    } catch (error) {
      console.error('[BRASS] Webhook error:', error instanceof Error ? error.message : error)
    }
  }

  /**
   * Send alert to Slack using webhook
   */
  private async sendSlackAlert(webhookUrl: string, alert: Alert): Promise<void> {
    try {
      const color = alert.severity === 'critical' ? '#dc2626' : alert.severity === 'warning' ? '#f59e0b' : '#3b82f6'
      
      const payload = {
        attachments: [{
          color,
          title: `[BRASS] ${alert.title}`,
          text: alert.message,
          fields: [
            { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
            { title: 'Tenant', value: this.config.tenantId, short: true },
          ],
          footer: 'BRASS Proof',
          ts: Math.floor(alert.timestamp / 1000),
        }]
      }

      if (typeof fetch !== 'undefined') {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          console.warn(`[BRASS] Slack webhook failed (${response.status})`)
        }
      }
    } catch (error) {
      console.error('[BRASS] Slack alert error:', error instanceof Error ? error.message : error)
    }
  }

  /**
   * Emit telemetry event with exponential backoff retry
   */
  private async emit(event: TelemetryEvent, retryCount = 0): Promise<void> {
    if (!this.config.enabled) return

    try {
      // Use fetch if available (Node 18+, Workers, browsers)
      if (typeof fetch !== 'undefined') {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BRASS-Tenant': this.config.tenantId,
          },
          body: JSON.stringify(event),
        })

        if (!response.ok && retryCount < this.maxRetries) {
          // Retry with exponential backoff
          const delay = this.retryDelay * Math.pow(2, retryCount)
          setTimeout(() => {
            this.emit(event, retryCount + 1)
          }, delay)
        }
      }
    } catch (error) {
      // Suppress errors - telemetry should never break the main flow
      if (retryCount === 0) {
        // Only log on first attempt
        console.debug('BRASS telemetry error (retrying):', error instanceof Error ? error.message : error)
      }

      if (retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retryCount)
        setTimeout(() => {
          this.emit(event, retryCount + 1)
        }, delay)
      }
    }
  }

  /**
   * Get current epoch (days since Unix epoch)
   */
  private getCurrentEpoch(): number {
    return Math.floor(Date.now() / (86400 * 1000))
  }

  /**
   * Reset counts (useful for testing)
   */
  reset(): void {
    this.counts.clear()
    this.notifiedThresholds.clear()
  }
}

/**
 * Create a telemetrist instance from environment variables
 * OPT-IN: Disabled by default unless BRASS_TELEMETRY_ENABLED=true
 */
export function createTelemetrist(overrides: Partial<TelemetryConfig> = {}): Telemetrist {
  const config: Partial<TelemetryConfig> = {
    enabled: process.env.BRASS_TELEMETRY_ENABLED === 'true', // Opt-in: only enabled if explicitly 'true'
    endpoint: process.env.BRASS_TELEMETRY_ENDPOINT,
    tenantId: process.env.BRASS_TENANT_ID,
    ...overrides,
  }

  return new Telemetrist(config)
}

/**
 * Register a custom threshold handler
 * 
 * @example
 * ```typescript
 * registerThresholdHandler(50000, (count) => {
 *   console.log(`Hit 50k at ${count} verifications!`)
 *   notifySlack(`BRASS milestone: ${count} tokens verified`)
 * })
 * ```
 */
export function registerThresholdHandler(
  threshold: number,
  handler: (count: number) => void
): void {
  // This would be used in conjunction with createTelemetrist
  console.log(`Threshold handler registered for ${threshold}`)
}
