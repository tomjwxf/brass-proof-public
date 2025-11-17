import { createBrassVerifier, type BrassSpendPayload } from '@brassproof/verifier'

export interface BrassWorkerEnv {
  BRASS_SECRET_KEY: string
  BRASS_ISSUER_PUBKEY: string
  BRASS_KV?: KVNamespace
  [key: string]: unknown
}

export interface BrassWorkerOptions {
  scope?: string
  rateLimits?: Record<string, { maxRequests: number; windowSeconds: number }>
  onVerified?: (result: { remaining: number; resetAt: number }) => void | Promise<void>
  onRateLimited?: (result: { remaining: number; resetAt: number }) => Response | Promise<Response>
  corsHeaders?: HeadersInit
}

export function createBrassWorker(
  handler: (request: Request, env: BrassWorkerEnv) => Promise<Response> | Response,
  options: BrassWorkerOptions = {}
) {
  return async (request: Request, env: BrassWorkerEnv): Promise<Response> => {
    const corsHeaders = options.corsHeaders || {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BRASS-Token',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders as HeadersInit })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders as HeadersInit
      })
    }

    try {
      if (!env.BRASS_SECRET_KEY || !env.BRASS_ISSUER_PUBKEY) {
        return new Response(
          JSON.stringify({ error: 'Server configuration error' }),
          { 
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders as Record<string, string> }
          }
        )
      }

      let body: { brassToken?: BrassSpendPayload; [key: string]: unknown }
      try {
        body = await request.json()
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders as Record<string, string> }
          }
        )
      }

      const brassToken = body.brassToken || request.headers.get('x-brass-token')
      
      if (!brassToken) {
        return new Response(
          JSON.stringify({ error: 'Missing BRASS token' }),
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders as Record<string, string> }
          }
        )
      }

      let payload: BrassSpendPayload
      try {
        payload = typeof brassToken === 'string'
          ? JSON.parse(atob(brassToken))
          : brassToken
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid BRASS token format' }),
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders as Record<string, string> }
          }
        )
      }

      const verifier = createBrassVerifier({
        secretKey: env.BRASS_SECRET_KEY,
        issuerPublicKey: env.BRASS_ISSUER_PUBKEY,
        kvNamespace: env.BRASS_KV,
        rateLimits: options.rateLimits,
      })

      const origin = request.headers.get('origin') || ''
      const scope = options.scope || 'generic'

      const result = await verifier.verify(payload, {
        origin,
        scope,
        clientIp: request.headers.get('cf-connecting-ip') || '',
        userAgent: request.headers.get('user-agent') || '',
      })

      if (!result.success) {
        if (options.onRateLimited && result.remaining !== undefined && result.resetAt) {
          return await options.onRateLimited({
            remaining: result.remaining,
            resetAt: result.resetAt,
          })
        }

        return new Response(
          JSON.stringify({ 
            error: result.error || 'Verification failed',
            remaining: result.remaining || 0,
            resetAt: result.resetAt,
          }),
          { 
            status: 429,
            headers: { 'Content-Type': 'application/json', ...corsHeaders as Record<string, string> }
          }
        )
      }

      if (options.onVerified && result.remaining !== undefined && result.resetAt) {
        await options.onVerified({
          remaining: result.remaining,
          resetAt: result.resetAt,
        })
      }

      return await handler(request, env)
    } catch (error) {
      console.error('BRASS verification error:', error)
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders as Record<string, string> }
        }
      )
    }
  }
}

export { createBrassVerifier, type BrassVerifierConfig, type BrassSpendPayload } from '@brassproof/verifier'
