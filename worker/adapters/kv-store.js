// worker/adapters/kv-store.js
// KV-based storage adapter (Community tier - best-effort counters)

import { BrassCounterStore, buildCounterKey, buildLegacyCounterKey } from '../shared/storage-interface.js';

/**
 * KV Storage Adapter
 * 
 * Best-effort enforcement using Cloudflare KV.
 * Not atomic - suitable for Community tier where strict enforcement isn't required.
 */
export class KVStore extends BrassCounterStore {
  constructor(kvNamespace) {
    super();
    this.kv = kvNamespace;
    this.enableMigrationFallback = true;  // TODO: Remove after migration window
  }

  async spend(params) {
    const { key, IK, limit, ttlSeconds } = params;
    const counterKey = buildCounterKey(key);
    
    // SECURITY: Namespace idempotency keys by projectId to prevent cross-tenant collisions
    const ikKey = `ik:project:${key.projectId}:${IK}`;
    const existingResponse = await this.kv.get(ikKey);
    
    if (existingResponse) {
      // Idempotent replay - return EXACT cached response
      const cached = JSON.parse(existingResponse);
      return { 
        ...cached,
        idempotent: true 
      };
    }

    // Read current count (not atomic - best effort)
    const countKey = `count:${counterKey}`;
    let currentCount = parseInt(await this.kv.get(countKey) || '0', 10);
    
    // BACKWARD COMPATIBILITY: Migration fallback for pre-namespaced keys
    // TODO: Remove after all tenants migrated (30-day window recommended)
    if (currentCount === 0 && this.enableMigrationFallback) {
      const legacyKey = buildLegacyCounterKey(key);
      const legacyCountKey = `count:${legacyKey}`;
      const legacyCount = parseInt(await this.kv.get(legacyCountKey) || '0', 10);
      
      if (legacyCount > 0) {
        // Migrate: copy legacy count to new namespaced key
        currentCount = legacyCount;
        await this.kv.put(countKey, String(legacyCount), { expirationTtl: ttlSeconds });
      }
    }
    
    if (currentCount >= limit) {
      // Limit exceeded - store FAILURE response
      const failureResponse = { 
        ok: false, 
        error: 'limit_exceeded',
        remaining: 0
      };
      
      await this.kv.put(ikKey, JSON.stringify(failureResponse), { 
        expirationTtl: ttlSeconds 
      });
      
      return failureResponse;
    }

    // Increment counter (race condition possible in Community tier - acceptable)
    const newCount = currentCount + 1;
    const remaining = Math.max(0, limit - newCount);
    
    // Success - store SUCCESS response
    const successResponse = { 
      ok: true, 
      remaining 
    };
    
    await Promise.all([
      this.kv.put(countKey, String(newCount), { expirationTtl: ttlSeconds }),
      this.kv.put(ikKey, JSON.stringify(successResponse), { expirationTtl: ttlSeconds })
    ]);

    return successResponse;
  }
  
  /**
   * Check grace guard (prevents double-spend at UTC midnight boundary)
   */
  async guardGrace({ projectId, graceKey, ttlSeconds }) {
    // SECURITY: Namespace by projectId
    const key = `grace:project:${projectId}:${graceKey}`;
    const cached = await this.kv.get(key);
    
    if (cached) {
      // Cache hit - return cached response
      return { 
        hit: true, 
        response: JSON.parse(cached)
      };
    }
    
    return { hit: false };
  }
  
  /**
   * Cache response for grace guard
   */
  async cacheGraceResponse({ projectId, graceKey, ttlSeconds, response }) {
    // SECURITY: Namespace by projectId
    const key = `grace:project:${projectId}:${graceKey}`;
    
    // Best-effort SETNX: check if exists before putting
    // Note: KV doesn't have true atomic SETNX, so race conditions possible (acceptable for Community tier)
    const existing = await this.kv.get(key);
    if (!existing) {
      await this.kv.put(key, JSON.stringify(response), { 
        expirationTtl: ttlSeconds 
      });
    }
  }
}
