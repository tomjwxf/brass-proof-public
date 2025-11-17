import { createBrassVerifier } from '@brassproof/verifier'

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    if (new URL(request.url).pathname !== '/verify') {
      return new Response('Not found', { status: 404 })
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      const authHeader = request.headers.get('Authorization')
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Missing or invalid authorization header' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }

      const providedSecret = authHeader.slice(7)
      if (providedSecret !== env.BRASS_SECRET_KEY) {
        return new Response(
          JSON.stringify({ error: 'Invalid secret key' }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }

      const body = await request.json()
      const { origin, scope, token } = body

      if (!origin || !token) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: origin, token' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }

      const verifier = createBrassVerifier({
        secretKey: env.BRASS_SECRET_KEY,
        issuerPublicKey: env.BRASS_ISSUER_PUBKEY,
        kvNamespace: env.BRASS_KV,
        rateLimits: {
          'comment-submission': { maxRequests: 3, windowSeconds: 86400 },
          'signup': { maxRequests: 5, windowSeconds: 86400 },
          'generic': { maxRequests: 10, windowSeconds: 86400 },
        },
        replayWindowSeconds: 3600,
      })

      const result = await verifier.verify(token, {
        origin,
        scope: scope || 'generic',
        clientIp: request.headers.get('CF-Connecting-IP'),
        userAgent: request.headers.get('User-Agent'),
      })

      if (result.success) {
        return new Response(
          JSON.stringify({
            success: true,
            remaining: result.remaining,
            resetAt: result.resetAt,
          }),
          { 
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          }
        )
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: result.error,
            remaining: result.remaining || 0,
            resetAt: result.resetAt,
          }),
          { 
            status: 429,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          }
        )
      }
    } catch (error) {
      console.error('Verification error:', error)
      return new Response(
        JSON.stringify({ 
          error: 'Internal server error',
          message: error.message 
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        }
      )
    }
  }
}
