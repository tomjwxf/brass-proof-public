// worker/tests/utils/mock-worker-env.js
// Utilities for testing Cloudflare Worker handlers

/**
 * MockKV - In-memory KV store for testing
 */
export class MockKV {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    return this.store.get(key) || null;
  }

  async put(key, value, options = {}) {
    this.store.set(key, value);
    if (options.expirationTtl) {
      setTimeout(() => this.store.delete(key), options.expirationTtl * 1000);
    }
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list(options = {}) {
    const keys = Array.from(this.store.keys())
      .filter(k => !options.prefix || k.startsWith(options.prefix))
      .slice(0, options.limit || 1000);
    return {
      keys: keys.map(name => ({ name })),
      list_complete: true
    };
  }
}

/**
 * Create mock Worker environment for deterministic-verifier tests
 * 
 * @param {Object} config
 * @param {string} config.apiKey - Test API key
 * @param {string} config.projectId - Test project ID
 * @param {number} config.limit - Rate limit
 * @param {string} config.issuerPubKey - Issuer public key (base64url)
 * @param {MockKV} [config.kvStore] - Optional pre-configured KV store
 * @returns {Object} Mock env object
 */
export function mockEnvFactory(config) {
  const {
    apiKey = 'test_api_key',
    projectId = 'test_project',
    limit = 10,
    issuerPubKey,
    kvStore = new MockKV()
  } = config;

  const env = {
    BRASS_KV: kvStore,
    BRASS_ISSUER_PUBKEY: issuerPubKey,
    BRASS_SECRET_KEY: apiKey,
    BRASS_PROJECT_ID: projectId,
    BRASS_RATE_LIMIT: String(limit),
    BRASS_USE_ENV_AUTH: true, // Use simple auth for testing
    STORAGE_BACKEND: 'kv'
  };

  return env;
}

/**
 * Create mock execution context
 */
export function mockContext() {
  const promises = [];
  return {
    waitUntil(promise) {
      promises.push(promise);
    },
    passThroughOnException() {},
    promises
  };
}

/**
 * Build a Request object for spend verification
 * 
 * @param {Object} payload - Proof payload
 * @param {Object} options
 * @param {string} options.apiKey - Authorization Bearer token
 * @param {string} options.baseUrl - Base URL for request
 * @returns {Request} Request object
 */
export function buildSpendRequest(payload, options = {}) {
  const {
    apiKey = 'test_api_key',
    baseUrl = 'https://brass-verifier.example.com'
  } = options;

  return new Request(baseUrl + '/spend', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

/**
 * Extract response body as JSON
 */
export async function responseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { error: 'invalid_json', text };
  }
}
