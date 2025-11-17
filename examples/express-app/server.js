import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createBrassVerifier } from '@brassproof/verifier'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY,
  rateLimits: {
    'comment-submission': { maxRequests: 3, windowSeconds: 86400 }
  }
})

app.post('/api/submit-comment', async (req, res) => {
  try {
    const { brassToken, comment } = req.body

    if (!brassToken) {
      return res.status(400).json({ error: 'Missing BRASS token' })
    }

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ error: 'Comment cannot be empty' })
    }

    let payload
    try {
      payload = typeof brassToken === 'string'
        ? JSON.parse(Buffer.from(brassToken, 'base64').toString())
        : brassToken
    } catch {
      return res.status(400).json({ error: 'Invalid BRASS token format' })
    }

    const result = await verifier.verify(payload, {
      origin: req.headers.origin || 'http://localhost:3000',
      scope: 'comment-submission',
      clientIp: req.ip,
      userAgent: req.headers['user-agent'] || ''
    })

    if (!result.success) {
      return res.status(429).json({
        error: result.error || 'Rate limit exceeded',
        remaining: result.remaining || 0,
        resetAt: result.resetAt
      })
    }

    console.log('✅ Comment submitted:', comment.substring(0, 50) + '...')

    res.json({
      success: true,
      message: 'Comment submitted successfully!',
      remaining: result.remaining,
      resetAt: result.resetAt
    })
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📝 Open http://localhost:${PORT} to test the BRASS-protected form`)
})
