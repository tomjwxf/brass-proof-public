# BRASS Strict Verifier - Deployment Checklist

## Critical Bug Fix Applied

**Issue Fixed**: Line 137 of `strict-verifier.js` was treating `eta` as a UTF-8 string instead of decoding from base64url, causing a mismatch in the `y` computation.

**Fix**: Changed `Hlabel(CONFIG.LABEL_Y, b64ud(Zprime), KID, AADr, eta)` to `Hlabel(CONFIG.LABEL_Y, b64ud(Zprime), KID, AADr, b64ud(eta))`

## Deployment Steps

### 1. Deploy the Issuer Worker First

```bash
cd worker

# Deploy issuer (if not already deployed)
wrangler deploy --config issuer-wrangler.toml
```

### 2. Get the Issuer's Public Key

```bash
# Call the /pub endpoint to get the public key Y
curl https://your-issuer.workers.dev/pub

# For managed service, use: https://brassproof.com/api/issuer/pub
# Or get your public key from the dashboard at https://brassproof.com/dashboard

# This will return:
# {"KID":"kid-rotate-2025-10","Y":"<base64url_encoded_public_key>"}
```

### 3. Configure Verifier Secrets

You MUST set these secrets on the verifier worker:

```bash
# 1. Set the BRASS API key (used by your backend to call the verifier)
wrangler secret put BRASS_SECRET_KEY
# Enter: A secure random string (e.g., sk_live_...)

# 2. Set the issuer's public key (from step 2)
wrangler secret put BRASS_ISSUER_PUBKEY
# Paste the Y value from the /pub endpoint response
```

### 4. Deploy the Verifier Worker

```bash
# Deploy the fixed verifier
wrangler deploy

# Or if using a custom config:
# wrangler deploy --config wrangler.toml
```

### 5. Verify Deployment

```bash
# Test health endpoint
curl https://your-verifier.workers.dev/health

# For managed service, use: https://brassproof.com/api/verify/health

# Should return:
# {"ok":true,"ts":...,"build":"strict-verifier-v1.1","kid":"kid-rotate-2025-10"}
```

## Common Issues

### Issue: "Worker threw exception" (500 error)

**Causes**:
1. `BRASS_ISSUER_PUBKEY` secret not set or invalid
2. `BRASS_SECRET_KEY` secret not set
3. KV namespace not bound correctly
4. Invalid point encoding in request

**Solution**:
- Verify secrets are set: `wrangler secret list`
- Check worker logs: `wrangler tail` (while making requests)
- Ensure KV namespace is bound in wrangler.toml

### Issue: "invalid_piI" (401 error)

**Cause**: The issuer's DLEQ proof πI failed verification

**Solution**:
- Verify BRASS_ISSUER_PUBKEY matches the issuer's actual public key
- Check that issuer is generating valid proofs

### Issue: "y_mismatch" (401 error)

**Cause**: The salted token y doesn't match server recomputation

**Solution**:
- This was the bug that was just fixed! Redeploy the verifier with the fix.
- Ensure both client and verifier are using the same `eta` byte representation

### Issue: "invalid_piC" (401 error)

**Cause**: The client's DLEQ proof πC failed verification

**Solution**:
- Verify client is using the correct challenge label (OPRF_METERING_DLEQ_v1)
- Check that A2 commitment is bare G (not G.multiply(w))
- Verify binding hash includes all required fields in correct order

## Environment Variables Reference

### Verifier (strict-verifier.js)
- `BRASS_SECRET_KEY` (secret) - API key for backend authentication
- `BRASS_ISSUER_PUBKEY` (secret) - Issuer's public key Y in base64url
- `KV` (binding) - KV namespace for replay protection
- `COUNTER` (binding, optional) - Durable Object for single-writer counters

### Issuer (issuer-intermediate.js)
- `ISSUER_K_HEX` (secret) - 64-character hex string (32 bytes)

## Testing After Deployment

Try posting a comment on the demo page at `/pro-demo`. You should see:
1. Client mints a token from the issuer
2. Client builds spend proof with πC
3. Backend sends proof to verifier
4. Verifier validates and returns success with remaining count

If it fails, check:
```bash
# View real-time logs from verifier
wrangler tail

# View real-time logs from issuer (in another terminal)
wrangler tail --config issuer-wrangler.toml
```
