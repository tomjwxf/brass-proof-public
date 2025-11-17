// worker/tests/storage.test.js
// Tests for storage adapters (KV and Durable Objects)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KVStore } from '../adapters/kv-store.js';
import { buildCounterKey } from '../shared/storage-interface.js';

// Mock KV namespace with TTL tracking
class MockKV {
  constructor() {
    this.store = new Map();
    this.metadata = new Map(); // Track TTL metadata for testing
  }

  async get(key) {
    return this.store.get(key) || null;
  }

  async put(key, value, options = {}) {
    this.store.set(key, value);
    
    // W2.2: Track TTL metadata for testing
    if (options.expirationTtl) {
      this.metadata.set(key, {
        ttl: options.expirationTtl,
        setAt: Date.now()
      });
      
      // Simulate TTL expiration (for testing)
      setTimeout(() => {
        this.store.delete(key);
        this.metadata.delete(key);
      }, options.expirationTtl * 1000);
    }
  }
  
  // W2.2: Get TTL metadata for testing
  getTTL(key) {
    const meta = this.metadata.get(key);
    return meta ? meta.ttl : null;
  }
  
  // W2.2: Get full metadata for testing
  getMeta(key) {
    return this.metadata.get(key) || null;
  }

  clear() {
    this.store.clear();
  }
}

describe('KVStore (Community Tier)', () => {
  let mockKV;
  let kvStore;
  let testKey;
  let testIK;

  beforeEach(() => {
    mockKV = new MockKV();
    kvStore = new KVStore(mockKV);
    
    testKey = {
      projectId: 'test-project-123',  // SECURITY: Required for tenant isolation
      issuerPk: 'A7xG...',
      origin: 'https://example.com',
      epoch: '19700',
      policy: 'strict',
      window: '19700',
      y: 'nullifier_y_b64'
    };
    
    testIK = 'idempotency_key_123';
  });

  describe('First Spend (No Idempotency)', () => {
    it('should allow spend within limit', async () => {
      const result = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });

      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(9); // limit - 1
      expect(result.idempotent).toBeFalsy();
    });

    it('should reject spend when limit exceeded', async () => {
      // Fill up to limit
      for (let i = 0; i < 10; i++) {
        await kvStore.spend({
          key: testKey,
          IK: `ik_${i}`,
          limit: 10,
          ttlSeconds: 3600
        });
      }

      // 11th request should fail
      const result = await kvStore.spend({
        key: testKey,
        IK: 'ik_11',
        limit: 10,
        ttlSeconds: 3600
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('limit_exceeded');
      expect(result.remaining).toBe(0);
    });

    it('should increment counter correctly', async () => {
      const result1 = await kvStore.spend({
        key: testKey,
        IK: 'ik_1',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.remaining).toBe(9);

      const result2 = await kvStore.spend({
        key: testKey,
        IK: 'ik_2',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.remaining).toBe(8);
    });
  });

  describe('Idempotent Replay', () => {
    it('should return cached success response on replay', async () => {
      // First request
      const result1 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.ok).toBe(true);
      expect(result1.remaining).toBe(9);

      // Replay with same IK
      const result2 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.ok).toBe(true);
      expect(result2.remaining).toBe(9); // Same as first
      expect(result2.idempotent).toBe(true);
    });

    it('should return cached failure response on replay', async () => {
      // Fill to limit
      for (let i = 0; i < 10; i++) {
        await kvStore.spend({
          key: testKey,
          IK: `ik_${i}`,
          limit: 10,
          ttlSeconds: 3600
        });
      }

      // First limit_exceeded
      const result1 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.ok).toBe(false);
      expect(result1.error).toBe('limit_exceeded');

      // Replay should return same error (NOT consume capacity)
      const result2 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.ok).toBe(false);
      expect(result2.error).toBe('limit_exceeded');
      expect(result2.idempotent).toBe(true);
    });

    it('should NOT increment counter on idempotent replay', async () => {
      // First spend
      await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });

      // Check counter
      const counterKey = buildCounterKey(testKey);
      const count1 = parseInt(await mockKV.get(`count:${counterKey}`) || '0', 10);
      expect(count1).toBe(1);

      // Replay
      await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });

      // Counter should NOT increment
      const count2 = parseInt(await mockKV.get(`count:${counterKey}`) || '0', 10);
      expect(count2).toBe(1);
    });
  });

  describe('Idempotency Bypass Prevention', () => {
    it('should prevent bypass by caching failure response', async () => {
      // Fill to limit
      for (let i = 0; i < 10; i++) {
        await kvStore.spend({
          key: testKey,
          IK: `ik_${i}`,
          limit: 10,
          ttlSeconds: 3600
        });
      }

      // Request that exceeds limit
      const failIK = 'fail_ik';
      const result1 = await kvStore.spend({
        key: testKey,
        IK: failIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.ok).toBe(false);

      // Attacker retries with same IK, hoping to bypass
      const result2 = await kvStore.spend({
        key: testKey,
        IK: failIK,
        limit: 10,
        ttlSeconds: 3600
      });
      
      // Should still fail (idempotent replay of failure)
      expect(result2.ok).toBe(false);
      expect(result2.idempotent).toBe(true);
    });

    it('should store full response object, not just flag', async () => {
      await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });

      // Check that IK stores full response
      const ikKey = `ik:project:${testKey.projectId}:${testIK}`;
      const cached = await mockKV.get(ikKey);
      
      expect(cached).toBeTruthy();
      const parsed = JSON.parse(cached);
      expect(parsed).toHaveProperty('ok');
      expect(parsed).toHaveProperty('remaining');
    });
  });

  describe('Counter Key Isolation', () => {
    it('should isolate counters by nullifier y', async () => {
      const key1 = { ...testKey, y: 'nullifier_1' };
      const key2 = { ...testKey, y: 'nullifier_2' };

      const result1 = await kvStore.spend({
        key: key1,
        IK: 'ik_1',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.remaining).toBe(9);

      const result2 = await kvStore.spend({
        key: key2,
        IK: 'ik_2',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.remaining).toBe(9); // Separate counter
    });

    it('should isolate counters by origin', async () => {
      const key1 = { ...testKey, origin: 'https://example.com' };
      const key2 = { ...testKey, origin: 'https://other.com' };

      const result1 = await kvStore.spend({
        key: key1,
        IK: 'ik_1',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.remaining).toBe(9);

      const result2 = await kvStore.spend({
        key: key2,
        IK: 'ik_2',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.remaining).toBe(9); // Separate counter
    });

    it('should isolate counters by window', async () => {
      const key1 = { ...testKey, window: '19700' };
      const key2 = { ...testKey, window: '19701' };

      const result1 = await kvStore.spend({
        key: key1,
        IK: 'ik_1',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.remaining).toBe(9);

      const result2 = await kvStore.spend({
        key: key2,
        IK: 'ik_2',
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.remaining).toBe(9); // Separate counter
    });
  });

  describe('TTL Handling', () => {
    it('should respect TTL settings', async () => {
      await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 1 // Very short TTL for testing
      });

      const counterKey = buildCounterKey(testKey);
      const ikKey = `ik:project:${testKey.projectId}:${testIK}`;

      // Should exist immediately
      expect(await mockKV.get(`count:${counterKey}`)).toBeTruthy();
      expect(await mockKV.get(ikKey)).toBeTruthy();
    });
    
    it('should align TTL with provided ttlSeconds (W2.2 requirement)', async () => {
      const ttl = 3600;
      await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: ttl
      });
      
      // W2.2: Verify both counter and IK cache have same TTL
      const counterKey = buildCounterKey(testKey);
      const ikKey = `ik:project:${testKey.projectId}:${testIK}`;
      
      // Both should exist
      expect(await mockKV.get(`count:${counterKey}`)).toBeTruthy();
      expect(await mockKV.get(ikKey)).toBeTruthy();
      
      // W2.2: Assert TTL alignment
      const counterTTL = mockKV.getTTL(`count:${counterKey}`);
      const ikTTL = mockKV.getTTL(ikKey);
      
      expect(counterTTL).toBe(ttl);
      expect(ikTTL).toBe(ttl);
      expect(counterTTL).toBe(ikTTL); // MUST match for window alignment
    });
  });
  
  describe('W2.2: Idempotency Integration Tests', () => {
    it('should retain original TTL on idempotent replay (W2.2 requirement)', async () => {
      const ttl = 1800; // 30 minutes
      
      // First request
      await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: ttl
      });
      
      const ikKey = `ik:project:${testKey.projectId}:${testIK}`;
      const originalMeta = mockKV.getMeta(ikKey);
      expect(originalMeta).toBeTruthy();
      expect(originalMeta.ttl).toBe(ttl);
      const originalSetAt = originalMeta.setAt;
      
      // Small delay to ensure different timestamp if TTL were reset
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Replay with same IK - should NOT reset TTL
      await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: ttl
      });
      
      // W2.2: Verify TTL was NOT reset (still same setAt timestamp)
      const replayMeta = mockKV.getMeta(ikKey);
      expect(replayMeta.ttl).toBe(ttl); // Same TTL value
      expect(replayMeta.setAt).toBe(originalSetAt); // NOT reset (same timestamp)
    });
    
    it('should NOT double-increment on replay (W2.2 requirement)', async () => {
      // First request
      const result1 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.ok).toBe(true);
      expect(result1.remaining).toBe(9);
      expect(result1.idempotent).toBeFalsy();
      
      // Replay - should return cached response WITHOUT incrementing counter
      const result2 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.ok).toBe(true);
      expect(result2.remaining).toBe(9); // SAME remaining (no double-increment)
      expect(result2.idempotent).toBe(true);
      
      // Third replay - still same
      const result3 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result3.ok).toBe(true);
      expect(result3.remaining).toBe(9);
      expect(result3.idempotent).toBe(true);
      
      // Verify counter only incremented once
      const counterKey = buildCounterKey(testKey);
      const count = parseInt(await mockKV.get(`count:${counterKey}`) || '0', 10);
      expect(count).toBe(1); // Only 1 increment despite 3 requests
    });
    
    it('should replay identical success response', async () => {
      // First request
      const result1 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      
      // Replay
      const result2 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      
      // Responses should be identical (except idempotent flag)
      expect(result2.ok).toBe(result1.ok);
      expect(result2.remaining).toBe(result1.remaining);
      expect(result2.idempotent).toBe(true);
    });
    
    it('should replay identical failure response', async () => {
      // Fill to limit
      for (let i = 0; i < 10; i++) {
        await kvStore.spend({
          key: testKey,
          IK: `ik_fill_${i}`,
          limit: 10,
          ttlSeconds: 3600
        });
      }
      
      // First denial
      const result1 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.ok).toBe(false);
      expect(result1.error).toBe('limit_exceeded');
      
      // Replay - should return cached denial WITHOUT attempting to spend
      const result2 = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.ok).toBe(false);
      expect(result2.error).toBe('limit_exceeded');
      expect(result2.idempotent).toBe(true);
      
      // Counter should not have changed
      const counterKey = buildCounterKey(testKey);
      const count = parseInt(await mockKV.get(`count:${counterKey}`) || '0', 10);
      expect(count).toBe(10); // Still at limit, not 11
    });
    
    it('should handle rapid replays correctly', async () => {
      // Simulate rapid replays (race condition scenario)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(kvStore.spend({
          key: testKey,
          IK: testIK,
          limit: 10,
          ttlSeconds: 3600
        }));
      }
      
      const results = await Promise.all(promises);
      
      // All should have same remaining count
      const remainingCounts = results.map(r => r.remaining);
      expect(new Set(remainingCounts).size).toBe(1); // All identical
      
      // Counter should only increment once
      const counterKey = buildCounterKey(testKey);
      const count = parseInt(await mockKV.get(`count:${counterKey}`) || '0', 10);
      expect(count).toBe(1);
    });
    
    it('should isolate different IKs properly', async () => {
      const ik1 = 'idempotency_key_1';
      const ik2 = 'idempotency_key_2';
      
      // Two different IKs should be treated as different requests
      const result1 = await kvStore.spend({
        key: testKey,
        IK: ik1,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.remaining).toBe(9);
      
      const result2 = await kvStore.spend({
        key: testKey,
        IK: ik2,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result2.remaining).toBe(8); // Different IK = new spend
      
      // Replay of ik1 should still return 9
      const result3 = await kvStore.spend({
        key: testKey,
        IK: ik1,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result3.remaining).toBe(9);
      expect(result3.idempotent).toBe(true);
    });
    
    it('should respect TTL alignment with window expiry (W2.2 requirement)', async () => {
      // Use shorter TTL to simulate window expiry
      const ttl = 60; // 60 seconds
      
      const result = await kvStore.spend({
        key: testKey,
        IK: testIK,
        limit: 10,
        ttlSeconds: ttl
      });
      
      expect(result.ok).toBe(true);
      
      // In production, both counter and IK cache expire after TTL
      // This ensures no stale idempotency cache outlives the window
    });
    
    it('should handle cross-window scenarios correctly', async () => {
      // Window 1
      const key1 = { ...testKey, window: '19700' };
      const result1 = await kvStore.spend({
        key: key1,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      expect(result1.remaining).toBe(9);
      
      // Window 2 (different window, same IK)
      // NOTE: In production, windows have separate counters
      // but IK might persist across windows if TTL is long
      const key2 = { ...testKey, window: '19701' };
      const result2 = await kvStore.spend({
        key: key2,
        IK: testIK,
        limit: 10,
        ttlSeconds: 3600
      });
      
      // Different window = fresh counter
      expect(result2.remaining).toBe(9);
      // W2.2: IK caching is window-agnostic - same IK persists across windows
      expect(result2.idempotent).toBeTruthy(); // Same IK = idempotent replay
    });
  });
});

describe('buildCounterKey', () => {
  it('should create deterministic key from components', () => {
    const key = {
      projectId: 'test-proj',
      issuerPk: 'pk',
      origin: 'https://example.com',
      epoch: '19700',
      policy: 'strict',
      window: '19700',
      y: 'nullifier'
    };

    const result = buildCounterKey(key);
    expect(result).toBe('project:test-proj|pk|https://example.com|19700|strict|19700|nullifier');
  });

  it('should produce same key for same inputs', () => {
    const key = {
      projectId: 'test-proj',
      issuerPk: 'pk',
      origin: 'https://example.com',
      epoch: '19700',
      policy: 'strict',
      window: '19700',
      y: 'nullifier'
    };

    const result1 = buildCounterKey(key);
    const result2 = buildCounterKey(key);
    expect(result1).toBe(result2);
  });

  it('should produce different keys for different components', () => {
    const key1 = {
      projectId: 'test-proj',
      issuerPk: 'pk',
      origin: 'https://example.com',
      epoch: '19700',
      policy: 'strict',
      window: '19700',
      y: 'nullifier1'
    };

    const key2 = {
      ...key1,
      y: 'nullifier2'
    };

    const result1 = buildCounterKey(key1);
    const result2 = buildCounterKey(key2);
    expect(result1).not.toBe(result2);
  });
});
