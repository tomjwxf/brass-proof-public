import { NextRequest, NextResponse } from 'next/server'
import { createBrassVerifier, type BrassVerifierConfig, type BrassSpendPayload } from '@brassproof/verifier'

export interface WithBrassVerifierOptions extends Omit<BrassVerifierConfig, 'secretKey' | 'issuerPublicKey'> {
  scope?: string
  onVerified?: (result: { remaining: number; resetAt: number }) => void | Promise<void>
  onRateLimited?: (result: { remaining: number; resetAt: number }) => NextResponse | Promise<NextResponse>
}

export type BrassProtectedHandler = (
  request: NextRequest,
  context: { params: Record<string, string | string[]> }
) => Promise<NextResponse> | NextResponse

export function withBrassVerifier(
  handler: BrassProtectedHandler,
  options: WithBrassVerifierOptions = {}
) {
  return async (
    request: NextRequest,
    context: { params: Record<string, string | string[]> } = { params: {} }
  ): Promise<NextResponse> => {
    try {
      const secretKey = process.env.BRASS_SECRET_KEY
      const issuerPublicKey = process.env.BRASS_ISSUER_PUBKEY

      if (!secretKey || !issuerPublicKey) {
        console.error('BRASS_SECRET_KEY or BRASS_ISSUER_PUBKEY not configured')
        return NextResponse.json(
          { error: 'Server configuration error' },
          { status: 500 }
        )
      }

      const body = await request.json()
      const brassToken = body.brassToken || request.headers.get('x-brass-token')

      if (!brassToken) {
        return NextResponse.json(
          { error: 'Missing BRASS token' },
          { status: 400 }
        )
      }

      let payload: BrassSpendPayload
      try {
        payload = typeof brassToken === 'string' 
          ? JSON.parse(Buffer.from(brassToken, 'base64').toString())
          : brassToken
      } catch {
        return NextResponse.json(
          { error: 'Invalid BRASS token format' },
          { status: 400 }
        )
      }

      const verifier = createBrassVerifier({
        secretKey,
        issuerPublicKey,
        ...options,
      })

      const origin = request.headers.get('origin') || ''
      const scope = options.scope || 'generic'

      const result = await verifier.verify(payload, {
        origin,
        scope,
        clientIp: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '',
        userAgent: request.headers.get('user-agent') || '',
      })

      if (!result.success) {
        if (options.onRateLimited && result.remaining !== undefined && result.resetAt) {
          return await options.onRateLimited({
            remaining: result.remaining,
            resetAt: result.resetAt,
          })
        }

        return NextResponse.json(
          { 
            error: result.error || 'Verification failed',
            remaining: result.remaining || 0,
            resetAt: result.resetAt,
          },
          { status: 429 }
        )
      }

      if (options.onVerified && result.remaining !== undefined && result.resetAt) {
        await options.onVerified({
          remaining: result.remaining,
          resetAt: result.resetAt,
        })
      }

      return await handler(request, context)
    } catch (error) {
      console.error('BRASS verification error:', error)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
  }
}
