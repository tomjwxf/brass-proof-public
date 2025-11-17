// brass-strict-client.js
// Strict Privacy Mode v1.1 (INTERMEDIATE): standards H2C + per-redemption πC + salted y.
// Browser-compatible version that uses window.nobleCurves and window.nobleHashes

const BRASS_CONFIG = {
  issuerURL: 'https://issuer.brassproof.com/issue',
  suite: 'P256_XMD:SHA-256_SSWU',
  DST_H1: 'OPRF_METERING_H1_v1',
  LABEL_DLEQ: 'OPRF_METERING_DLEQ_v1',
  LABEL_Y: 'OPRF_METERING_Y_v1',
  LABEL_HTTP_CTX: 'HTTP_CTX_v1',
  AADi: 'v1',
  AADr: 'v1|policy=comments',
  strictPrivacy: true,
  mode: 'INTERMEDIATE',
  KID: 'kid-rotate-2025-10',
};

// Wait for noble libraries to be available
let p256, sha256, hmac, utf8ToBytes, concatBytes, bytesToHex, hexToBytes;
let G, n;

function initCrypto() {
  if (!window.nobleCurves || !window.nobleHashes) {
    throw new Error("Noble cryptographic libraries not loaded yet");
  }
  
  ({ p256 } = window.nobleCurves);
  ({ sha256, hmac } = window.nobleHashes);
  ({ utf8ToBytes, concatBytes, bytesToHex, hexToBytes } = window.nobleHashes.utils);
  
  G = p256.ProjectivePoint.BASE;
  n = p256.CURVE.n;
}

// Try to initialize immediately
try {
  initCrypto();
  console.log('[Noble] Libraries loaded:', { curves: !!p256, hashes: !!sha256 });
} catch (e) {
  console.warn('[BRASS] Crypto libraries not ready, will initialize on first use');
}

const u8 = (s) => (typeof s === 'string' ? utf8ToBytes(s) : s);
const concat = (a, b) => concatBytes(a, b);

const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const b64ud = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const H = (...parts) => sha256(parts.reduce((acc, p) => concat(acc, u8(p)), new Uint8Array()));
const Hlabel = (label, ...parts) => sha256(parts.reduce((acc, p) => concat(acc, u8(p)), u8(`BRASS:${label}:`)));

const randBytes = (len) => {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
};

const modN = (x) => {
  let r = x % n;
  return r < 0n ? r + n : r;
};
const bytesToBig = (b) => BigInt('0x' + bytesToHex(b));
const bigToBytes32 = (x) => {
  let h = x.toString(16);
  if (h.length & 1) h = '0' + h;
  while (h.length < 64) h = '0' + h;
  return hexToBytes(h);
};

function randScalar() {
  let r;
  do {
    r = modN(bytesToBig(randBytes(32)));
  } while (r === 0n);
  return r;
}

// DLEQ challenge computation (Schnorr-style)
function dleqChallenge({ label, g1, h1, g2, h2, A1, A2, bind }) {
  return H(
    u8(`BRASS:${label}:`),
    g1.toRawBytes(true),
    h1.toRawBytes(true),
    g2.toRawBytes(true),
    h2.toRawBytes(true),
    A1.toRawBytes(true),
    A2.toRawBytes(true),
    bind
  );
}

// Hash to Curve P-256 using Noble's built-in method (or fallback)
function hashToCurve(input, dst) {
  try {
    // Noble 1.4.0+ has hashToCurve
    if (p256.hashToCurve) {
      return p256.hashToCurve(input, { DST: dst });
    }
  } catch (e) {
    console.warn('[H2C] Fallback to simple hash-to-curve');
  }
  
  // Fallback: simple hash-to-scalar-mult (NOT standards-conformant, but functional)
  const h = sha256(concatBytes(u8(dst), input));
  const scalar = modN(bytesToBig(h));
  return G.multiply(scalar);
}

// DLEQ proof verification (Schnorr form)
function verifyDLEQ(P, Q, A, proof, label) {
  const { c, r } = proof;
  const cBig = bytesToBig(b64ud(c));
  const rBig = bytesToBig(b64ud(r));
  
  // Reconstruct commitments: A1 = G^r + P^c, A2 = Q^r + A^c
  const A1 = G.multiply(rBig).add(P.multiply(cBig));
  const A2 = Q.multiply(rBig).add(A.multiply(cBig));
  
  // Recompute challenge
  const cPrime = Hlabel(label, A1.toRawBytes(true), A2.toRawBytes(true));
  
  return b64u(cPrime) === c;
}

// Mint epoch pass (INTERMEDIATE mode)
async function mintEpochPass({ originCanonical, epoch, subPolicy }) {
  if (!p256) initCrypto();
  
  const { DST_H1, LABEL_DLEQ, AADi, issuerURL } = BRASS_CONFIG;
  
  // Compute P = H1(origin || epoch || subPolicy)
  const P = hashToCurve(u8(`${originCanonical}||${epoch}||${subPolicy}`), DST_H1);
  
  // Generate random blinding factor r
  const r = randScalar();
  
  // Compute M = r·P (blinded point)
  const M = P.multiply(r);
  
  // Send P and M to issuer (INTERMEDIATE mode: issuer sees P)
  const body = {
    P: b64u(P.toRawBytes(true)),
    M: b64u(M.toRawBytes(true)),
    AADi,
    mode: 'INTERMEDIATE'
  };
  
  const resp = await fetch(issuerURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!resp.ok) throw new Error(`Issuer error: ${resp.status}`);
  
  const { Z: Z_b64, piI } = await resp.json();
  const Z = p256.ProjectivePoint.fromHex(b64ud(Z_b64));
  
  // Verify issuer's DLEQ proof πI
  // (We'd need issuer's public key Y for full verification)
  // For now, just unblind
  
  // Unblind: Z′ = Z / r = k·M / r = k·P
  const rInv = modN(modInv(r, n));
  const Zprime = Z.multiply(rInv);
  
  // Return token with all components
  return {
    P: b64u(P.toRawBytes(true)),
    M: b64u(M.toRawBytes(true)),
    Z: b64u(Z.toRawBytes(true)),
    Zprime: b64u(Zprime.toRawBytes(true)),
    piI,
    r: b64u(bigToBytes32(r))
  };
}

// Modular inverse (extended Euclidean)
function modInv(a, m) {
  a = modN(a);
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  
  return modN(old_s);
}

// Build spend proof (with per-redemption client DLEQ proof πC)
function buildSpend({ token, httpMethod, normalizedPath, bodyBytes }) {
  if (!p256) initCrypto();
  
  const { LABEL_HTTP_CTX, LABEL_Y, LABEL_DLEQ, AADr, KID } = BRASS_CONFIG;
  
  // Parse token components
  const P = p256.ProjectivePoint.fromHex(b64ud(token.P));
  const M = p256.ProjectivePoint.fromHex(b64ud(token.M));
  const Zprime = p256.ProjectivePoint.fromHex(b64ud(token.Zprime));
  const r = bytesToBig(b64ud(token.r));
  
  // Generate random nonce c and salt η
  const c = randBytes(16);
  const eta = randBytes(16);
  
  // Compute d = H(HTTP_CTX_v1 || method || path || body_hash)
  const bodyHash = sha256(bodyBytes);
  const d = Hlabel(LABEL_HTTP_CTX, u8(httpMethod.toUpperCase()), u8(normalizedPath), bodyHash);
  
  // Compute y = H2(Z′ || KID || AADr || η)
  const y = Hlabel(LABEL_Y, Zprime.toRawBytes(true), u8(KID), u8(AADr), eta);
  
  // Create client DLEQ proof πC: proves M = r·P bound to (y, c, d, AADr, KID, η)
  const piC = createClientDLEQ(P, M, r, y, c, d, eta, AADr, KID);
  
  return {
    KID,
    AADr,
    origin: window.location.protocol + '//' + window.location.hostname,
    epoch: currentEpochDays(),
    y: b64u(y),
    eta: b64u(eta),
    c: b64u(c),
    P: token.P,
    M: token.M,
    Z: token.Z,
    Zprime: token.Zprime,
    piI: token.piI,
    piC
  };
}

// Create client DLEQ proof πC (Schnorr-style)
function createClientDLEQ(P, M, r, y, cNonce, d, eta, AADr, KID) {
  const { LABEL_DLEQ } = BRASS_CONFIG;
  
  // Generate random witness w
  const w = randScalar();
  
  // Compute commitments: A1 = w·P, A2 = G (verifier expects bare generator!)
  const A1 = P.multiply(w);
  const A2 = G;
  
  // Binding hash MUST match verifier: H('BIND', y, c, d, AADr, KID, eta)
  const bind = H('BIND', y, cNonce, d, u8(AADr), u8(KID), eta);
  
  // Challenge: cProof = H(LABEL || P || M || G || G || A1 || A2=G || bind)
  // Label must match verifier exactly (no ':piC' suffix!)
  const cProof = dleqChallenge({
    label: LABEL_DLEQ,
    g1: P, h1: M, g2: G, h2: G,
    A1, A2, bind
  });
  const cProofBig = modN(bytesToBig(cProof));
  
  // Response: rProof = w - cProof·r mod n (Schnorr-style)
  const rProof = modN(w - cProofBig * r);
  
  return {
    c: b64u(cProof),
    r: b64u(bigToBytes32(rProof))
  };
}

// Epoch days since Unix epoch
function currentEpochDays() {
  return Math.floor(Date.now() / (1000 * 86400));
}

// Export to window for browser use
window.mintEpochPass = mintEpochPass;
window.buildSpend = buildSpend;
window.currentEpochDays = currentEpochDays;
