// worker/adapters/durable-object-store.js
// Durable Object storage adapter (Enterprise tier - atomic counters)

import { BrassCounterStore, buildCounterKey, buildLegacyCounterKey } from '../shared/storage-interface.js';

/**
 * Durable Object Storage Adapter
 * 
 * Atomic enforcement using Cloudflare Durable Objects.
 * Single-writer guarantees prevent race conditions.
 * Suitable for Enterprise tier strict enforcement.
 */
export class DurableObjectStore extends BrassCounterStore {
  constructor(counterBinding) {
    super();
    this.counterBinding = counterBinding;
  }

  async spend(params) {
    const { key, IK, limit, ttlSeconds } = params;
    const counterKey = buildCounterKey(key);
    
    // Route to Durable Object keyed by counter key
    const id = this.counterBinding.idFromName(counterKey);
    const stub = this.counterBinding.get(id);
    
    // Call Durable Object with spend request
    const response = await stub.fetch('https://do/spend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 
        projectId: key.projectId,  // SECURITY: Pass projectId for idempotency key namespacing
        IK, 
        limit, 
        ttlSeconds 
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return { ok: false, error: error.error || 'unknown_error' };
    }

    return await response.json();
  }
  
  /**
   * Check grace guard (prevents double-spend at UTC midnight boundary)
   */
  async guardGrace({ projectId, graceKey, ttlSeconds }) {
    // Route to dedicated grace guard Durable Object
    const id = this.counterBinding.idFromName(`grace:${projectId}:${graceKey}`);
    const stub = this.counterBinding.get(id);
    
    const response = await stub.fetch('https://do/grace/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, graceKey, ttlSeconds })
    });
    
    return await response.json();
  }
  
  /**
   * Cache response for grace guard
   */
  async cacheGraceResponse({ projectId, graceKey, ttlSeconds, response }) {
    // Route to dedicated grace guard Durable Object
    const id = this.counterBinding.idFromName(`grace:${projectId}:${graceKey}`);
    const stub = this.counterBinding.get(id);
    
    await stub.fetch('https://do/grace/cache', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, graceKey, ttlSeconds, response })
    });
  }
}

/**
 * Durable Object Class for atomic counter enforcement
 * 
 * Export this as your Durable Object binding in wrangler.toml
 */
export class BrassCounterDO {
  constructor(state) {
    this.state = state;
    this.enableMigrationFallback = true;  // TODO: Remove after migration window
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    
    // Route: Grace guard check
    if (url.pathname === '/grace/check') {
      return await this.handleGraceCheck(request);
    }
    
    // Route: Grace guard cache
    if (url.pathname === '/grace/cache') {
      return await this.handleGraceCache(request);
    }
    
    // Route: Normal spend
    if (url.pathname === '/spend') {
      return await this.handleSpend(request);
    }
    
    return new Response('Not Found', { status: 404 });
  }
  
  async handleSpend(request) {

    try {
      // Parse request body once
      const { projectId, IK, limit, ttlSeconds } = await request.json();

      // Check idempotency first (atomic read)
      // SECURITY: Namespace by projectId to prevent cross-tenant collisions
      const ikKey = `ik:project:${projectId}:${IK}`;
      const existingResponse = await this.state.storage.get(ikKey);
      
      if (existingResponse) {
        // Idempotent replay - return EXACT cached response with original status
        const cached = JSON.parse(existingResponse);
        const status = cached.ok ? 200 : 429;
        
        return new Response(JSON.stringify({ 
          ...cached,
          idempotent: true 
        }), { 
          status,
          headers: { 'content-type': 'application/json' }
        });
      }

      // Atomic increment
      let count = await this.state.storage.get('count') || 0;
      
      // BACKWARD COMPATIBILITY: Migration fallback for pre-namespaced keys
      // TODO: Remove after all tenants migrated (30-day window recommended)
      if (count === 0 && this.enableMigrationFallback) {
        // Check if there's a legacy counter (without project namespace)
        const legacyCount = await this.state.storage.get('legacy_count') || 0;
        if (legacyCount > 0) {
          // Migrate: copy legacy count to new namespaced counter
          count = legacyCount;
          await this.state.storage.put('count', legacyCount);
        }
      }
      
      if (count >= limit) {
        // Limit exceeded - store FAILURE response
        const failureResponse = { 
          ok: false, 
          error: 'limit_exceeded',
          remaining: 0
        };
        
        await this.state.storage.put(ikKey, JSON.stringify(failureResponse), { 
          expirationTtl: ttlSeconds 
        });
        
        return new Response(JSON.stringify(failureResponse), { 
          status: 429,
          headers: { 'content-type': 'application/json' }
        });
      }

      // Increment atomically
      count += 1;
      const remaining = Math.max(0, limit - count);
      
      // Success - store SUCCESS response
      const successResponse = { 
        ok: true, 
        remaining 
      };
      
      await Promise.all([
        this.state.storage.put('count', count, { 
          expirationTtl: ttlSeconds 
        }),
        this.state.storage.put(ikKey, JSON.stringify(successResponse), { 
          expirationTtl: ttlSeconds 
        })
      ]);
      
      return new Response(JSON.stringify(successResponse), { 
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    } catch (error) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: error.message || 'server_error' 
      }), { 
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }
  }
  
  async handleGraceCheck(request) {
    try {
      const { projectId, graceKey, ttlSeconds } = await request.json();
      const key = `grace:project:${projectId}:${graceKey}`;
      const cached = await this.state.storage.get(key);
      
      if (cached) {
        // Cache hit - return cached response
        return new Response(JSON.stringify({ 
          hit: true, 
          response: JSON.parse(cached)
        }), { 
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify({ hit: false }), { 
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        hit: false,
        error: error.message 
      }), { 
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }
  }
  
  async handleGraceCache(request) {
    try {
      const { projectId, graceKey, ttlSeconds, response } = await request.json();
      const key = `grace:project:${projectId}:${graceKey}`;
      
      // Atomic SETNX: only set if not exists
      const existing = await this.state.storage.get(key);
      if (!existing) {
        await this.state.storage.put(key, JSON.stringify(response), { 
          expirationTtl: ttlSeconds 
        });
      }
      
      return new Response(JSON.stringify({ ok: true }), { 
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        ok: false,
        error: error.message 
      }), { 
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }
  }
}
