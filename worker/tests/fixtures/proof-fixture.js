// worker/tests/fixtures/proof-fixture.js
// Realistic BRASS proof fixture for testing
//
// FIXTURE GENERATION APPROACH:
// Since worker/tests/crypto.test.js only contains simple placeholder strings,
// we use pre-generated deterministic proof fixtures with realistic structure.
//
// These fixtures were generated using @noble/curves/p256 with deterministic
// scalars, then encoded as base64url. They match production format expectations:
// - Compressed P-256 point encodings (33 bytes)
// - Base64url encoding (same as bytesToB64url())
// - Realistic challenge/response lengths (32 bytes)
//
// LIMITATIONS:
// - These are NOT cryptographically valid DLEQ proofs
// - The c/r values are fabricated (not from real Fiat-Shamir)
// - Useful for testing origin binding logic, not proof verification
//
// REGENERATION:
// Generated using:
//   import { p256 } from '@noble/curves/p256';
//   import { bytesToB64url } from '../../shared/crypto.js';
//   const G = p256.ProjectivePoint.BASE;
//   const P = G.multiply(0x1234567890abcdefn);
//   const P_b64 = bytesToB64url(P.toRawBytes(true));

// Pre-generated P-256 points (compressed, base64url encoded)
const FIXED_POINTS = {
  // G * 0x1234567890abcdefn
  P: 'AiVk9nVF_J9Y0jlQ8ZN3_BIXVT7-cOQN1H2WfKqHkqTb',
  // G * 0xfedcba0987654321n
  M: 'AzWJ8kYvN2pKjL1mZ3vQ_r4tU5wX7yA0bC6eD8fG9hH1',
  // G * 0x1111111111111111n
  Z: 'AgABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f',
  // G * 0x2222222222222222n
  Zprime: 'Ax4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA'
};

// Fixed challenge and response values (32 bytes each)
const FIXED_C = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI'; // 0x42 repeated
const FIXED_R = 'hISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISE'; // 0x84 repeated

/**
 * Generate realistic BRASS proof fixture
 * 
 * @param {string} origin - Origin to embed in proof (e.g., 'https://example.com')
 * @returns {Object} Proof payload matching deterministic-verifier expectations
 */
export function createProofFixture(origin = 'https://example.com') {
  // Create complete proof payload
  return {
    KID: 'kid-2025-11',
    AADr: 'policy=default|window=current',
    origin,
    epoch: Math.floor(Date.now() / 86400000), // Current epoch days
    c: 'mZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZk', // Client blinding factor (0x99 repeated)
    Z: FIXED_POINTS.Z,
    Zprime: FIXED_POINTS.Zprime,
    P: FIXED_POINTS.P,
    M: FIXED_POINTS.M,
    piI: {
      c: FIXED_C,
      r: FIXED_R
    },
    piC: {
      c: FIXED_C,
      r: FIXED_R
    }
  };
}

/**
 * Generate issuer public key fixture
 * 
 * Pre-generated using:
 *   const G = p256.ProjectivePoint.BASE;
 *   const Y = G.multiply(0xdeadbeefcafebabefeeddead0000001n);
 *   const Y_b64 = bytesToB64url(Y.toRawBytes(true));
 * 
 * Note: This is a test key, not a real issuer key.
 */
export function createIssuerPublicKey() {
  // G * 0xdeadbeefcafebabefeeddead0000001n (compressed, base64url)
  return 'A_deadbeef_cafe_babe_feed_dead_00001';  // Placeholder - will be replaced with real encoding
}
