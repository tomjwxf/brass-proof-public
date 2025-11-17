# @brassproof/nextjs

BRASS integration for Next.js with React hooks and API route helpers. Add privacy-preserving rate limiting to your Next.js app in minutes.

## Installation

```bash
npm install @brassproof/nextjs
```

## Quick Start

### 1. Client-Side (React Hook)

```tsx
'use client'
import { useBrass } from '@brassproof/nextjs'

export function CommentForm() {
  const { mintAndSubmit, isLoading, error, remaining } = useBrass({
    scope: 'comment-submission',
    onSuccess: (result) => {
      console.log(`${result.remaining} comments remaining`)
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    await mintAndSubmit('/api/submit-comment', {
      comment: 'Hello world!'
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea name="comment" />
      <button disabled={isLoading}>
        {isLoading ? 'Posting...' : 'Post Comment'}
      </button>
      {error && <p>Error: {error.message}</p>}
      {remaining !== null && <p>{remaining} comments remaining today</p>}
    </form>
  )
}
```

### 2. Server-Side (API Route Protection)

```typescript
// app/api/submit-comment/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withBrassVerifier } from '@brassproof/nextjs'

async function handler(request: NextRequest) {
  const { comment } = await request.json()
  
  // Process the comment - BRASS has already verified rate limits
  console.log('Comment:', comment)
  
  return NextResponse.json({ success: true })
}

export const POST = withBrassVerifier(handler, {
  scope: 'comment-submission',
  onVerified: (result) => {
    console.log(`Verified! ${result.remaining} remaining`)
  },
})
```

## API Reference

### `useBrass(options?)`

React hook for client-side BRASS integration.

**Options:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `issuerUrl` | `string` | Hosted issuer | BRASS issuer endpoint URL |
| `scope` | `string` | `'generic'` | Rate limit scope identifier |
| `onError` | `(error: Error) => void` | - | Error callback |
| `onSuccess` | `(result) => void` | - | Success callback |

**Returns:**

```typescript
{
  mintAndSubmit: <T>(endpoint: string, data: object, options?: RequestInit) => Promise<T>
  isLoading: boolean
  error: Error | null
  remaining: number | null
}
```

**Example:**

```tsx
const { mintAndSubmit, isLoading, error } = useBrass({
  scope: 'signup',
  onSuccess: () => alert('Account created!'),
  onError: (err) => console.error(err),
})

await mintAndSubmit('/api/signup', {
  email: 'user@example.com',
  password: 'secure123'
})
```

### `withBrassVerifier(handler, options?)`

Higher-order function to protect Next.js API routes.

**Options:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `scope` | `string` | `'generic'` | Rate limit scope |
| `rateLimits` | `Record<string, RateLimit>` | Defaults | Custom rate limits |
| `kvNamespace` | `KVNamespace` | - | Storage backend for rate limiting |
| `onVerified` | `(result) => void \| Promise<void>` | - | Called after successful verification |
| `onRateLimited` | `(result) => NextResponse` | - | Custom rate limit response |

**Example:**

```typescript
import { withBrassVerifier } from '@brassproof/nextjs'

const handler = async (request: NextRequest) => {
  // Your protected logic here
  return NextResponse.json({ success: true })
}

export const POST = withBrassVerifier(handler, {
  scope: 'api-call',
  rateLimits: {
    'api-call': { maxRequests: 100, windowSeconds: 3600 }
  },
  onRateLimited: ({ remaining, resetAt }) => {
    return NextResponse.json(
      { 
        error: 'Too many requests',
        remaining,
        resetAt: new Date(resetAt).toISOString()
      },
      { status: 429 }
    )
  }
})
```

## Environment Variables

```bash
# Required
BRASS_SECRET_KEY=your_secret_key_here
BRASS_ISSUER_PUBKEY=issuer_public_key_hex

# Optional (for self-hosted or managed service)
BRASS_ISSUER_URL=https://your-issuer-endpoint.com
```

Get these values:
- **Self-hosted**: See [SECURITY.md](../../SECURITY.md) for deployment guide
- **Managed service**: Get from [brassproof.com](https://brassproof.com) dashboard

## Complete Example

### Client Component

```tsx
'use client'
import { useState } from 'react'
import { useBrass } from '@brassproof/nextjs'

export function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  
  const { mintAndSubmit, isLoading, error, remaining } = useBrass({
    scope: 'signup',
    onSuccess: () => {
      alert('Account created successfully!')
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      await mintAndSubmit('/api/signup', { email, password })
    } catch (err) {
      console.error('Signup failed:', err)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creating account...' : 'Sign Up'}
      </button>
      {error && <p className="error">{error.message}</p>}
      {remaining !== null && (
        <p>{remaining} signups remaining today</p>
      )}
    </form>
  )
}
```

### API Route

```typescript
// app/api/signup/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withBrassVerifier } from '@brassproof/nextjs'
import { hashPassword, createUser } from '@/lib/auth'

async function signupHandler(request: NextRequest) {
  const { email, password } = await request.json()

  // Validate input
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password required' },
      { status: 400 }
    )
  }

  // Create user in database
  const hashedPassword = await hashPassword(password)
  const user = await createUser(email, hashedPassword)

  return NextResponse.json({
    success: true,
    userId: user.id,
  })
}

export const POST = withBrassVerifier(signupHandler, {
  scope: 'signup',
  rateLimits: {
    'signup': { maxRequests: 5, windowSeconds: 86400 } // 5 per day
  },
})
```

## Advanced Usage

### Custom Rate Limits Per Scope

```typescript
export const POST = withBrassVerifier(handler, {
  rateLimits: {
    'comment': { maxRequests: 3, windowSeconds: 86400 },
    'signup': { maxRequests: 5, windowSeconds: 86400 },
    'api-call': { maxRequests: 100, windowSeconds: 3600 },
  },
})
```

### Custom Error Handling

```tsx
const { mintAndSubmit } = useBrass({
  scope: 'comment',
  onError: (error) => {
    if (error.message.includes('Rate limit')) {
      toast.error('Too many comments. Try again tomorrow!')
    } else {
      toast.error('Something went wrong')
    }
  },
  onSuccess: (result) => {
    toast.success(`Comment posted! ${result.remaining} remaining`)
  },
})
```

### TypeScript Types

```typescript
import type { 
  UseBrassOptions,
  UseBrassReturn,
  WithBrassVerifierOptions,
  BrassProtectedHandler,
} from '@brassproof/nextjs'

const options: UseBrassOptions = {
  scope: 'comment',
}

const handler: BrassProtectedHandler = async (request) => {
  // Your logic
  return NextResponse.json({ success: true })
}
```

## Troubleshooting

### "Missing BRASS token"

Ensure the client is sending the token. Check that `useBrass().mintAndSubmit()` is being used correctly.

### "Server configuration error"

Set `BRASS_SECRET_KEY` and `BRASS_ISSUER_PUBKEY` environment variables.

### "Rate limit exceeded"

User has hit the rate limit. This is expected behavior. Wait for the rate limit window to reset.

## Learn More

- [@brassproof/verifier](https://www.npmjs.com/package/@brassproof/verifier) - Core verifier SDK
- [BRASS Documentation](https://docs.brassproof.com)
- [GitHub Repository](https://github.com/brassproof/brass-nextjs)

## License

MIT - see [LICENSE](./LICENSE) for details.
