// worker/tests/cross-origin-replay.test.js
// End-to-end test: Cross-origin proof replay prevention via crypto primitives
//
// TESTING APPROACH:
// Instead of testing the full deterministic-verifier.fetch() handler (which
// has module resolution issues with @noble/curves in Vitest), we test the
// underlying crypto primitives that enforce origin binding:
// - deriveEta() produces different η for different origins
// - deriveNullifierY() produces different y for different η
// - buildCounterKey() isolates counters by origin
//
// This proves the mechanism behind cross-origin replay prevention without
// needing to mock the full Worker environment.

import { describe, it, expect } from 'vitest';
import {
  canonicalOrigin,
  deriveEta,
  deriveNullifierY,
  currentEpochDays,
  windowId,
  parsePolicyId
} from '../shared/crypto.js';
import { buildCounterKey } from '../shared/storage-interface.js';

describe('W3: Cross-Origin Replay Prevention (Crypto Primitives)', () => {
  describe('Canonicalization Requirement (Crypto Property Tests)', () => {
    // NOTE: These tests verify deriveEta's behavior but DO NOT exercise
    // the full deterministic-verifier.fetch() flow. A bug in the verifier
    // that skips canonicalOrigin() would NOT be caught by these tests.
    // Full verifier integration tests deferred to W5+.

    it('PROPERTY: deriveEta does NOT canonicalize internally', () => {
      // Proves: deriveEta trusts caller to pass canonical origin
      // Does NOT prove: verifier actually calls canonicalOrigin()
      
      const issuerPK = 'test_issuer_pubkey';
      const rawOrigin = 'HTTPS://EXAMPLE.COM:443/';  // Non-canonical
      const canonicalVersion = 'https://example.com'; // Canonical
      const epochDays = currentEpochDays();
      const policyId = 'default';
      const window = windowId(epochDays);

      // deriveEta with raw origin produces different result
      const eta_raw = deriveEta(issuerPK, rawOrigin, epochDays, policyId, window);

      // deriveEta with canonical origin
      const eta_canonical = deriveEta(issuerPK, canonicalVersion, epochDays, policyId, window);

      // Different because deriveEta doesn't canonicalize
      expect(eta_raw).not.toEqual(eta_canonical);
      
      // Verify canonical form
      expect(canonicalOrigin(rawOrigin)).toBe(canonicalVersion);
    });

    it('PROPERTY: verifier correctness requires canonical origin input', () => {
      // Proves: Using raw vs canonical origins produces different η
      // Does NOT prove: verifier pipeline actually re-derives canonical form
      
      const issuerPK = 'test_issuer_pubkey';
      const attackerOrigin = 'https://attacker.com';
      const victimOriginRaw = 'HTTPS://VICTIM.COM:443/';
      const victimOriginCanonical = 'https://victim.com';
      const epochDays = currentEpochDays();
      const policyId = 'default';
      const window = windowId(epochDays);

      const eta_attacker = deriveEta(issuerPK, attackerOrigin, epochDays, policyId, window);
      const eta_victim_raw = deriveEta(issuerPK, victimOriginRaw, epochDays, policyId, window);
      const eta_victim_canonical = deriveEta(issuerPK, victimOriginCanonical, epochDays, policyId, window);

      // All three produce different η
      expect(eta_victim_raw).not.toEqual(eta_victim_canonical);
      expect(eta_attacker).not.toEqual(eta_victim_raw);
      expect(eta_attacker).not.toEqual(eta_victim_canonical);
    });

    it('should derive different η for different origins', () => {
      const issuerPK = 'test_issuer_pubkey';
      const origin1 = 'https://example.com';
      const origin2 = 'https://attacker.com';
      const epochDays = currentEpochDays();
      const policyId = 'default';
      const window = windowId(epochDays);

      const eta1 = deriveEta(issuerPK, origin1, epochDays, policyId, window);
      const eta2 = deriveEta(issuerPK, origin2, epochDays, policyId, window);

      // Different origins produce different η
      expect(eta1).not.toEqual(eta2);
      expect(eta1.length).toBe(32);
      expect(eta2.length).toBe(32);
    });

    it('should derive same η for canonically equivalent origins (when pre-canonicalized)', () => {
      const issuerPK = 'test_issuer_pubkey';
      const origin1 = 'https://example.com';
      const origin2 = 'HTTPS://EXAMPLE.COM:443/';  // Non-canonical variant
      const epochDays = currentEpochDays();
      const policyId = 'default';
      const window = windowId(epochDays);

      // BOTH must be canonicalized before passing to deriveEta
      const canonical1 = canonicalOrigin(origin1);
      const canonical2 = canonicalOrigin(origin2);

      const eta1 = deriveEta(issuerPK, canonical1, epochDays, policyId, window);
      const eta2 = deriveEta(issuerPK, canonical2, epochDays, policyId, window);

      // Canonically equivalent origins produce same η (when both canonicalized)
      expect(canonical1).toBe(canonical2);
      expect(eta1).toEqual(eta2);
    });

    it('should bind η to all inputs (issuer, origin, epoch, policy, window)', () => {
      const issuerPK = 'test_issuer_pubkey';
      const origin = 'https://example.com';
      const epochDays = currentEpochDays();
      const policyId = 'default';
      const window = windowId(epochDays);

      const eta1 = deriveEta(issuerPK, origin, epochDays, policyId, window);
      
      // Change each input and verify η changes
      const eta_diffIssuer = deriveEta('different_issuer', origin, epochDays, policyId, window);
      const eta_diffOrigin = deriveEta(issuerPK, 'https://other.com', epochDays, policyId, window);
      const eta_diffEpoch = deriveEta(issuerPK, origin, epochDays + 1, policyId, window);
      const eta_diffPolicy = deriveEta(issuerPK, origin, epochDays, 'other', window);
      const eta_diffWindow = deriveEta(issuerPK, origin, epochDays, policyId, window + '_other');

      expect(eta_diffIssuer).not.toEqual(eta1);
      expect(eta_diffOrigin).not.toEqual(eta1);
      expect(eta_diffEpoch).not.toEqual(eta1);
      expect(eta_diffPolicy).not.toEqual(eta1);
      expect(eta_diffWindow).not.toEqual(eta1);
    });
  });

  describe('η → y Transitive Binding', () => {
    it('should derive different y for different η', () => {
      const encZprime = 'test_zprime';
      const KID = 'kid-2025-11';
      const AADr = 'policy=default';
      
      const eta1 = new Uint8Array(32).fill(0x01);
      const eta2 = new Uint8Array(32).fill(0x02);

      const y1 = deriveNullifierY(encZprime, KID, AADr, eta1);
      const y2 = deriveNullifierY(encZprime, KID, AADr, eta2);

      // Different η produce different y
      expect(y1).not.toEqual(y2);
      expect(y1.length).toBe(32);
      expect(y2.length).toBe(32);
    });

    it('should bind y to all inputs (Zprime, KID, AADr, η)', () => {
      const encZprime = 'test_zprime';
      const KID = 'kid-2025-11';
      const AADr = 'policy=default';
      const eta = new Uint8Array(32).fill(0x42);

      const y1 = deriveNullifierY(encZprime, KID, AADr, eta);

      // Change each input and verify y changes
      const y_diffZprime = deriveNullifierY('different_zprime', KID, AADr, eta);
      const y_diffKID = deriveNullifierY(encZprime, 'different_kid', AADr, eta);
      const y_diffAADr = deriveNullifierY(encZprime, KID, 'policy=other', eta);
      const eta_diff = new Uint8Array(32).fill(0x99);
      const y_diffEta = deriveNullifierY(encZprime, KID, AADr, eta_diff);

      expect(y_diffZprime).not.toEqual(y1);
      expect(y_diffKID).not.toEqual(y1);
      expect(y_diffAADr).not.toEqual(y1);
      expect(y_diffEta).not.toEqual(y1);
    });
  });

  describe('y → Counter Key Binding', () => {
    it('should create different counter keys for different origins', () => {
      const projectId = 'test_project';
      const origin1 = 'https://example.com';
      const origin2 = 'https://attacker.com';
      const policyId = 'default';
      const y = 'test_nullifier_y';

      const key1 = buildCounterKey({ projectId, origin: origin1, policyId, y });
      const key2 = buildCounterKey({ projectId, origin: origin2, policyId, y });

      // Different origins produce different counter keys
      expect(key1).not.toBe(key2);
      expect(key1).toContain(projectId);
      expect(key2).toContain(projectId);
    });

    it('should create different counter keys for different nullifiers', () => {
      const projectId = 'test_project';
      const origin = 'https://example.com';
      const policyId = 'default';
      const y1 = 'nullifier1';
      const y2 = 'nullifier2';

      const key1 = buildCounterKey({ projectId, origin, policyId, y: y1 });
      const key2 = buildCounterKey({ projectId, origin, policyId, y: y2 });

      // Different nullifiers produce different counter keys
      expect(key1).not.toBe(key2);
    });

    it('should isolate counter keys by projectId', () => {
      const origin = 'https://example.com';
      const policyId = 'default';
      const y = 'test_nullifier';

      const key1 = buildCounterKey({ projectId: 'project1', origin, policyId, y });
      const key2 = buildCounterKey({ projectId: 'project2', origin, policyId, y });

      // Different projects produce different counter keys
      expect(key1).not.toBe(key2);
      expect(key1).toContain('project1');
      expect(key2).toContain('project2');
    });
  });

  describe('End-to-End Origin Binding Simulation', () => {
    it('should prevent cross-origin replay via η/y chain', () => {
      // Simulate verifier flow:
      // 1. Client gets proof for origin A
      // 2. Attacker tries to replay with origin B
      // 3. Verifier derives different η → different y → different counter → fails

      const issuerPK = 'test_issuer_pubkey';
      const originA = 'https://legitimate.com';
      const originB = 'https://attacker.com';
      const epochDays = currentEpochDays();
      const policyId = parsePolicyId('policy=default');
      const window = windowId(epochDays);
      const encZprime = 'test_zprime';
      const KID = 'kid-2025-11';
      const AADr = 'policy=default';
      const projectId = 'test_project';

      // Legitimate flow (origin A)
      const etaA = deriveEta(issuerPK, originA, epochDays, policyId, window);
      const yA = deriveNullifierY(encZprime, KID, AADr, etaA);
      const counterKeyA = buildCounterKey({ projectId, origin: originA, policyId, y: yA });

      // Attack flow (same proof, different origin B)
      const etaB = deriveEta(issuerPK, originB, epochDays, policyId, window);
      const yB = deriveNullifierY(encZprime, KID, AADr, etaB);
      const counterKeyB = buildCounterKey({ projectId, origin: originB, policyId, y: yB });

      // PROOF: Cross-origin replay produces different counter keys
      expect(etaA).not.toEqual(etaB);  // Different η
      expect(yA).not.toEqual(yB);      // Different y (transitive)
      expect(counterKeyA).not.toBe(counterKeyB);  // Different counters (isolated)

      // In production, this means:
      // - Attacker's replay uses counterB
      // - Legitimate user's tokens use counterA
      // - No interference between origins
    });

    it('should allow canonical equivalents to share counters', () => {
      // Canonical equivalents SHOULD derive same η/y/counter
      const issuerPK = 'test_issuer_pubkey';
      const origin1 = 'https://example.com';
      const origin2 = 'HTTPS://EXAMPLE.COM:443/';
      const epochDays = currentEpochDays();
      const policyId = 'default';
      const window = windowId(epochDays);
      const encZprime = 'test_zprime';
      const KID = 'kid-2025-11';
      const AADr = 'policy=default';
      const projectId = 'test_project';

      // Canonicalize first (as verifier does)
      const canonical1 = canonicalOrigin(origin1);
      const canonical2 = canonicalOrigin(origin2);

      const eta1 = deriveEta(issuerPK, canonical1, epochDays, policyId, window);
      const eta2 = deriveEta(issuerPK, canonical2, epochDays, policyId, window);

      const y1 = deriveNullifierY(encZprime, KID, AADr, eta1);
      const y2 = deriveNullifierY(encZprime, KID, AADr, eta2);

      const counterKey1 = buildCounterKey({ projectId, origin: canonical1, policyId, y: y1 });
      const counterKey2 = buildCounterKey({ projectId, origin: canonical2, policyId, y: y2 });

      // Canonical equivalents share the same counter
      expect(canonical1).toBe(canonical2);
      expect(eta1).toEqual(eta2);
      expect(y1).toEqual(y2);
      expect(counterKey1).toBe(counterKey2);
    });
  });
});
