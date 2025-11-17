# BRASS Vanilla HTML/JavaScript Example

A single-file HTML example showing BRASS integration **without any build tools, frameworks, or npm packages**.

Perfect for:
- Adding BRASS to existing websites
- Understanding how BRASS works under the hood
- Quick prototyping and testing
- Learning the BRASS protocol

## 🚀 Quick Start

**Option 1: Just open the file**
```bash
# Download and open in your browser
open index.html
```

**Option 2: Serve with Python**
```bash
python3 -m http.server 8000
# Visit: http://localhost:8000
```

**Option 3: Serve with PHP**
```bash
php -S localhost:8000
```

**Option 4: Use any static file server**
```bash
npx serve .
```

That's it! No build step, no npm install, no configuration.

## 📁 What's Included

This is a **single 350-line HTML file** containing:

✅ Complete BRASS client implementation  
✅ Cryptographic token minting  
✅ Simulated backend verification  
✅ Beautiful, responsive UI  
✅ Rate limiting demonstration (3 submissions/day)  
✅ No external dependencies (libraries loaded from CDN)  

## 🎯 How It Works

### 1. Import Crypto Libraries from CDN

```html
<script type="module">
  import { p256 } from 'https://esm.sh/@noble/curves@1.4.0/p256'
  import { sha256 } from 'https://esm.sh/@noble/hashes@1.4.0/sha256'
</script>
```

### 2. Mint BRASS Token

```javascript
async function getBrassToken(origin, scope) {
  // Compute P = H1(origin || epoch || scope)
  const P = p256.ProjectivePoint.hashToCurve(pHash)
  
  // Blind with random r
  const r = p256.utils.randomPrivateKey()
  const M = P.multiply(r)
  
  // Get signed token from issuer
  const { ZPrime, piI, KID } = await fetch(ISSUER_URL, {
    method: 'POST',
    body: JSON.stringify({ P, M })
  })
  
  // Unblind and return token
  const Z = ZPrime / r
  return { y: hash(Z), piI, piC, ... }
}
```

### 3. Submit with Token

```javascript
const brassToken = await getBrassToken(origin, 'contact-form')

await fetch('/api/contact', {
  method: 'POST',
  body: JSON.stringify({ brassToken, formData })
})
```

## 🔧 Integration into Your Website

### Copy-Paste Integration

1. **Copy the `getBrassToken()` function** from `index.html`
2. **Add the crypto library imports:**
   ```html
   <script type="module">
     import { p256 } from 'https://esm.sh/@noble/curves@1.4.0/p256'
     import { sha256 } from 'https://esm.sh/@noble/hashes@1.4.0/sha256'
   </script>
   ```
3. **Call `getBrassToken()` before form submission:**
   ```javascript
   form.addEventListener('submit', async (e) => {
     const token = await getBrassToken(origin, 'my-form')
     // Send token to your backend
   })
   ```

### Backend Verification

On your server, verify the token:

**Node.js:**
```javascript
import { createBrassVerifier } from '@brassproof/verifier'

const verifier = createBrassVerifier({
  secretKey: process.env.BRASS_SECRET_KEY,
  issuerPublicKey: process.env.BRASS_ISSUER_PUBKEY
})

app.post('/api/contact', async (req, res) => {
  const { brassToken, ...formData } = req.body
  
  const result = await verifier.verify(brassToken, {
    origin: req.headers.origin,
    scope: 'contact-form'
  })
  
  if (!result.success) {
    return res.status(429).json({ error: 'Rate limited' })
  }
  
  // Process form...
})
```

**PHP:**
```php
// Use the BRASS PHP SDK (coming soon)
```

**Python:**
```python
# Use the BRASS Python SDK (coming soon)
```

## 🎨 Customization

### Change Rate Limits

```javascript
// In the simulated backend (replace with real backend)
const MAX_SUBMISSIONS = 5 // Allow 5 submissions per day
```

### Change Scope

```javascript
const brassToken = await getBrassToken(
  window.location.origin,
  'newsletter-signup' // Different scope = different rate limit
)
```

### Styling

The CSS is all inline - customize colors, fonts, and layout directly in the `<style>` tag.

## 🔒 Security Notes

**⚠️ This example simulates backend verification client-side for demo purposes.**

In production:
- ✅ **Always verify tokens server-side**
- ✅ Use `@brassproof/verifier` in your backend
- ❌ Never trust client-side rate limiting
- ❌ Never expose your `BRASS_SECRET_KEY` in frontend code

## 📦 Real Backend Examples

See these for production-ready backends:
- [Express.js Example](../express-app/)
- [Next.js Example](../../brass-abuse-shield/)
- [Cloudflare Worker Example](../../worker/)

## 🌟 Advantages of This Approach

✅ **Zero dependencies** - No node_modules, no build step  
✅ **Easy to understand** - All code in one file  
✅ **Copy-paste ready** - Drop into any website  
✅ **Framework agnostic** - Works with anything  
✅ **Fast iteration** - Edit and refresh, that's it  

## 🤔 When to Use This

**Perfect for:**
- Prototyping BRASS integration
- Adding BRASS to legacy sites
- Learning how BRASS works
- Simple forms and contact pages

**Not ideal for:**
- Large SPAs (use Next.js/React integration)
- TypeScript projects (use npm packages)
- Complex apps (use framework integration)

## 📚 Learn More

- **Commercial Platform**: [brassproof.com](https://brassproof.com)
- **Documentation**: [brassproof.com/docs](https://brassproof.com/docs)
- **Self-Hosting Guide**: [SECURITY.md](../../SECURITY.md)
- **npm Packages**: 
  - [@brassproof/verifier](https://www.npmjs.com/package/@brassproof/verifier)
  - [@brassproof/nextjs](https://www.npmjs.com/package/@brassproof/nextjs)
- **GitHub Repository**: [github.com/tomjwxf/brass-proof-public](https://github.com/tomjwxf/brass-proof-public)

## 💡 Next Steps

1. Open `index.html` in your browser
2. Submit the form a few times
3. See rate limiting in action
4. Read the inline JavaScript comments
5. Copy the `getBrassToken()` function to your site
6. Add server-side verification

That's it! You're BRASS-protected with zero build complexity.
