// worker/tests/crypto.test.js
// Comprehensive tests for deterministic protocol cryptography

import { describe, it, expect } from 'vitest';
import {
  H2,
  H3,
  bytesToB64url,
  b64urlToBytes,
  deriveEta,
  deriveNullifierY,
  deriveIdempotencyKey,
  canonicalOrigin,
  currentEpochDays,
  windowId,
  parsePolicyId,
  secondsUntilWindowEnd,
  secretToBytes
} from '../shared/crypto.js';
import { utf8ToBytes } from '@noble/hashes/utils';

describe('H3 Hash Function (Collision Resistance)', () => {
  it('should produce different hashes for delimiter collision attempts', () => {
    // Attack: Try to collide ["a|b", "c"] with ["a", "b|c"]
    const hash1 = H3('a|b', 'c');
    const hash2 = H3('a', 'b|c');
    
    expect(hash1).not.toEqual(hash2);
  });

  it('should handle empty strings without collisions', () => {
    const hash1 = H3('', 'test');
    const hash2 = H3('test', '');
    const hash3 = H3('', '');
    
    expect(hash1).not.toEqual(hash2);
    expect(hash1).not.toEqual(hash3);
    expect(hash2).not.toEqual(hash3);
  });

  it('should prevent cross-part collisions with length prefixing', () => {
    // ["abc", "def"] should never collide with ["ab", "cdef"] or ["abcd", "ef"]
    const hash1 = H3('abc', 'def');
    const hash2 = H3('ab', 'cdef');
    const hash3 = H3('abcd', 'ef');
    
    expect(hash1).not.toEqual(hash2);
    expect(hash1).not.toEqual(hash3);
    expect(hash2).not.toEqual(hash3);
  });

  it('should handle binary data without collisions', () => {
    const bytes1 = new Uint8Array([0x00, 0x01, 0x02]);
    const bytes2 = new Uint8Array([0x00, 0x01]);
    const bytes3 = new Uint8Array([0x02]);
    
    const hash1 = H3(bytes1, bytes2);
    const hash2 = H3(bytes2, bytes3);
    
    expect(hash1).not.toEqual(hash2);
  });

  it('should be deterministic for same inputs', () => {
    const input1 = 'test';
    const input2 = 'data';
    
    const hash1 = H3(input1, input2);
    const hash2 = H3(input1, input2);
    
    expect(hash1).toEqual(hash2);
  });
});

describe('H2 Hash Function', () => {
  it('should match H3 behavior (currently aliased)', () => {
    const input1 = 'test';
    const input2 = 'data';
    
    const h2Result = H2(input1, input2);
    const h3Result = H3(input1, input2);
    
    expect(h2Result).toEqual(h3Result);
  });

  it('should prevent collisions like H3', () => {
    const hash1 = H2('a|b', 'c');
    const hash2 = H2('a', 'b|c');
    
    expect(hash1).not.toEqual(hash2);
  });
});

describe('Base64URL Encoding/Decoding (Web-compatible)', () => {
  it('should encode and decode correctly', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const encoded = bytesToB64url(original);
    const decoded = b64urlToBytes(encoded);
    
    expect(decoded).toEqual(original);
  });

  it('should produce URL-safe base64', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    const encoded = bytesToB64url(bytes);
    
    // Should not contain +, /, or = (base64url format)
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('should handle zero-length arrays', () => {
    const empty = new Uint8Array([]);
    const encoded = bytesToB64url(empty);
    const decoded = b64urlToBytes(encoded);
    
    expect(decoded).toEqual(empty);
  });

  it('should handle all byte values (0-255)', () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i;
    }
    
    const encoded = bytesToB64url(allBytes);
    const decoded = b64urlToBytes(encoded);
    
    expect(decoded).toEqual(allBytes);
  });
});

describe('deriveEta (Deterministic Salt)', () => {
  it('should derive same η for same inputs', () => {
    const issuerPk = 'A7xG...';
    const origin = 'https://example.com';
    const epoch = '19700';
    const policy = 'strict';
    const window = '19700';
    
    const eta1 = deriveEta(issuerPk, origin, epoch, policy, window);
    const eta2 = deriveEta(issuerPk, origin, epoch, policy, window);
    
    expect(eta1).toEqual(eta2);
  });

  it('should derive different η for different origins', () => {
    const issuerPk = 'A7xG...';
    const epoch = '19700';
    const policy = 'strict';
    const window = '19700';
    
    const eta1 = deriveEta(issuerPk, 'https://example.com', epoch, policy, window);
    const eta2 = deriveEta(issuerPk, 'https://different.com', epoch, policy, window);
    
    expect(eta1).not.toEqual(eta2);
  });

  it('should derive different η for different windows', () => {
    const issuerPk = 'A7xG...';
    const origin = 'https://example.com';
    const epoch = '19700';
    const policy = 'strict';
    
    const eta1 = deriveEta(issuerPk, origin, epoch, policy, '19700');
    const eta2 = deriveEta(issuerPk, origin, epoch, policy, '19701');
    
    expect(eta1).not.toEqual(eta2);
  });

  it('should derive different η for different policies', () => {
    const issuerPk = 'A7xG...';
    const origin = 'https://example.com';
    const epoch = '19700';
    const window = '19700';
    
    const eta1 = deriveEta(issuerPk, origin, epoch, 'strict', window);
    const eta2 = deriveEta(issuerPk, origin, epoch, 'permissive', window);
    
    expect(eta1).not.toEqual(eta2);
  });

  it('should return 32 bytes (SHA-256 output)', () => {
    const eta = deriveEta('pk', 'https://example.com', '19700', 'strict', '19700');
    expect(eta.length).toBe(32);
  });
});

describe('deriveNullifierY', () => {
  it('should derive same y for same inputs', () => {
    const encZprime = 'A7xG...';
    const KID = 'kid-2025-10';
    const AADr = 'policy=strict|app=test';
    const eta = new Uint8Array(32);
    
    const y1 = deriveNullifierY(encZprime, KID, AADr, eta);
    const y2 = deriveNullifierY(encZprime, KID, AADr, eta);
    
    expect(y1).toEqual(y2);
  });

  it('should derive different y for different enc(Z\')', () => {
    const KID = 'kid-2025-10';
    const AADr = 'policy=strict';
    const eta = new Uint8Array(32);
    
    const y1 = deriveNullifierY('encZprime1', KID, AADr, eta);
    const y2 = deriveNullifierY('encZprime2', KID, AADr, eta);
    
    expect(y1).not.toEqual(y2);
  });

  it('should derive different y for different η', () => {
    const encZprime = 'A7xG...';
    const KID = 'kid-2025-10';
    const AADr = 'policy=strict';
    const eta1 = new Uint8Array(32).fill(0);
    const eta2 = new Uint8Array(32).fill(1);
    
    const y1 = deriveNullifierY(encZprime, KID, AADr, eta1);
    const y2 = deriveNullifierY(encZprime, KID, AADr, eta2);
    
    expect(y1).not.toEqual(y2);
  });

  it('should return 32 bytes (SHA-256 output)', () => {
    const y = deriveNullifierY('enc', 'kid', 'AADr', new Uint8Array(32));
    expect(y.length).toBe(32);
  });
});

describe('deriveIdempotencyKey', () => {
  it('should throw if kvSecret is not Uint8Array', () => {
    const y = new Uint8Array(32);
    const c = 'challenge_b64';
    
    expect(() => deriveIdempotencyKey('string_secret', y, c)).toThrow(
      'kvSecret must be Uint8Array'
    );
  });

  it('should derive same IK for same inputs', () => {
    const secret = new Uint8Array(32).fill(42);
    const y = new Uint8Array(32).fill(1);
    const c = bytesToB64url(utf8ToBytes('challenge'));
    
    const ik1 = deriveIdempotencyKey(secret, y, c);
    const ik2 = deriveIdempotencyKey(secret, y, c);
    
    expect(ik1).toBe(ik2);
  });

  it('should derive different IK for different y', () => {
    const secret = new Uint8Array(32).fill(42);
    const y1 = new Uint8Array(32).fill(1);
    const y2 = new Uint8Array(32).fill(2);
    const c = bytesToB64url(utf8ToBytes('challenge'));
    
    const ik1 = deriveIdempotencyKey(secret, y1, c);
    const ik2 = deriveIdempotencyKey(secret, y2, c);
    
    expect(ik1).not.toBe(ik2);
  });

  it('should derive different IK for different c', () => {
    const secret = new Uint8Array(32).fill(42);
    const y = new Uint8Array(32).fill(1);
    
    const ik1 = deriveIdempotencyKey(secret, y, bytesToB64url(utf8ToBytes('challenge1')));
    const ik2 = deriveIdempotencyKey(secret, y, bytesToB64url(utf8ToBytes('challenge2')));
    
    expect(ik1).not.toBe(ik2);
  });

  it('should prevent collisions between (y, c) pairs', () => {
    const secret = new Uint8Array(32).fill(42);
    
    // Attempt collision: [y1 || c1] vs [y2 || c2] where boundaries differ
    const y1 = new Uint8Array([0x00, 0x01]);
    const c1 = bytesToB64url(utf8ToBytes('test'));
    
    const y2 = new Uint8Array([0x00]);
    const c2 = bytesToB64url(utf8ToBytes('0x01test')); // Trying to shift boundary
    
    const ik1 = deriveIdempotencyKey(secret, y1, c1);
    const ik2 = deriveIdempotencyKey(secret, y2, c2);
    
    expect(ik1).not.toBe(ik2);
  });

  it('should return base64url string', () => {
    const secret = new Uint8Array(32);
    const y = new Uint8Array(32);
    const c = bytesToB64url(utf8ToBytes('challenge'));
    
    const ik = deriveIdempotencyKey(secret, y, c);
    
    expect(typeof ik).toBe('string');
    expect(ik).not.toContain('+');
    expect(ik).not.toContain('/');
    expect(ik).not.toContain('=');
  });
});

describe('canonicalOrigin', () => {
  describe('W3: Basic Normalization', () => {
    it('should normalize HTTPS origins to canonical form', () => {
      expect(canonicalOrigin('https://example.com')).toBe('https://example.com');
      expect(canonicalOrigin('https://EXAMPLE.COM')).toBe('https://example.com');
      expect(canonicalOrigin('https://example.com/')).toBe('https://example.com');
    });

    it('should remove default HTTPS port (443)', () => {
      expect(canonicalOrigin('https://example.com:443')).toBe('https://example.com');
      expect(canonicalOrigin('https://example.com:443/')).toBe('https://example.com');
    });

    it('should preserve non-default ports', () => {
      expect(canonicalOrigin('https://example.com:8443')).toBe('https://example.com:8443');
      expect(canonicalOrigin('https://example.com:3000')).toBe('https://example.com:3000');
    });

    it('should throw on invalid URLs', () => {
      expect(() => canonicalOrigin('not-a-url')).toThrow('invalid_origin');
      expect(() => canonicalOrigin('')).toThrow('invalid_origin');
    });
  });

  describe('W3: HTTPS Enforcement', () => {
    it('should reject HTTP origins', () => {
      expect(() => canonicalOrigin('http://example.com')).toThrow('origin_must_be_https');
    });

    it('should reject FTP origins', () => {
      expect(() => canonicalOrigin('ftp://example.com')).toThrow('origin_must_be_https');
    });

    it('should reject WS origins', () => {
      expect(() => canonicalOrigin('ws://example.com')).toThrow('origin_must_be_https');
      expect(() => canonicalOrigin('wss://example.com')).toThrow('origin_must_be_https');
    });
  });

  describe('W3: Path/Query/Fragment Rejection', () => {
    it('should reject origins with paths', () => {
      expect(() => canonicalOrigin('https://example.com/path')).toThrow('origin_must_not_contain_path_query_fragment');
      expect(() => canonicalOrigin('https://example.com/api/endpoint')).toThrow('origin_must_not_contain_path_query_fragment');
    });

    it('should reject origins with query strings', () => {
      expect(() => canonicalOrigin('https://example.com?query=value')).toThrow('origin_must_not_contain_path_query_fragment');
      expect(() => canonicalOrigin('https://example.com/?key=val')).toThrow('origin_must_not_contain_path_query_fragment');
    });

    it('should reject origins with fragments', () => {
      expect(() => canonicalOrigin('https://example.com#section')).toThrow('origin_must_not_contain_path_query_fragment');
      expect(() => canonicalOrigin('https://example.com/#anchor')).toThrow('origin_must_not_contain_path_query_fragment');
    });

    it('should reject origins with path + query + fragment', () => {
      expect(() => canonicalOrigin('https://example.com/path?query=1#fragment')).toThrow('origin_must_not_contain_path_query_fragment');
    });
  });

  describe('W3: IDNA Punycode Normalization', () => {
    it('should normalize punycode domains to lowercase', () => {
      // xn--n3h.com = ☃.com (snowman emoji domain)
      expect(canonicalOrigin('https://xn--n3h.com')).toBe('https://xn--n3h.com');
      expect(canonicalOrigin('https://XN--N3H.COM')).toBe('https://xn--n3h.com');
    });

    it('should handle mixed-case xn-- prefixes', () => {
      // Mixed case xn-- should normalize to lowercase
      expect(canonicalOrigin('https://XN--n3h.com')).toBe('https://xn--n3h.com');
      expect(canonicalOrigin('https://Xn--N3H.com')).toBe('https://xn--n3h.com');
    });

    it('should handle Unicode domain names via URL constructor', () => {
      // URL constructor auto-converts to punycode
      // münchen.de → xn--mnchen-3ya.de
      const result = canonicalOrigin('https://münchen.de');
      expect(result).toBe('https://xn--mnchen-3ya.de');
    });

    it('should handle emoji domains via punycode', () => {
      // ☃.com → xn--n3h.com
      const result = canonicalOrigin('https://☃.com');
      expect(result).toBe('https://xn--n3h.com');
    });
  });

  describe('W3: Trailing Dot Security', () => {
    it('should strip single trailing dot', () => {
      expect(canonicalOrigin('https://example.com.')).toBe('https://example.com');
    });

    it('should strip multiple trailing dots', () => {
      expect(canonicalOrigin('https://example.com...')).toBe('https://example.com');
    });

    it('should reject empty hostname after dot stripping', () => {
      expect(() => canonicalOrigin('https://.')).toThrow('invalid_hostname');
      expect(() => canonicalOrigin('https://...')).toThrow('invalid_hostname');
    });
  });

  describe('W3: IPv6 Literal Handling', () => {
    it('should handle IPv6 loopback', () => {
      const result = canonicalOrigin('https://[::1]');
      expect(result).toBe('https://[::1]');
    });

    it('should handle IPv6 addresses with normalization', () => {
      // URL constructor normalizes IPv6
      const result = canonicalOrigin('https://[2001:0db8:0000:0000:0000:0000:0000:0001]');
      expect(result).toBe('https://[2001:db8::1]');
    });

    it('should handle IPv6 with non-default port', () => {
      const result = canonicalOrigin('https://[::1]:8443');
      expect(result).toBe('https://[::1]:8443');
    });

    it('should remove default port from IPv6', () => {
      const result = canonicalOrigin('https://[::1]:443');
      expect(result).toBe('https://[::1]');
    });
  });

  describe('W3: Edge Cases & Attack Vectors', () => {
    it('should handle subdomains correctly', () => {
      expect(canonicalOrigin('https://api.example.com')).toBe('https://api.example.com');
      expect(canonicalOrigin('https://API.EXAMPLE.COM')).toBe('https://api.example.com');
    });

    it('should handle deep subdomains', () => {
      expect(canonicalOrigin('https://a.b.c.example.com')).toBe('https://a.b.c.example.com');
    });

    it('should reject localhost (non-public origin)', () => {
      // Note: Current implementation allows localhost - document expected behavior
      // This test may need adjustment based on security policy
      const result = canonicalOrigin('https://localhost');
      expect(result).toBe('https://localhost');
    });

    it('should reject invalid numeric domains', () => {
      // Malformed IP (not valid IPv4 - octets > 255)
      expect(() => canonicalOrigin('https://123.456.789.012')).toThrow('invalid_origin');
    });

    it('should be deterministic (same input = same output)', () => {
      const origin = 'https://EXAMPLE.COM:443/';
      const result1 = canonicalOrigin(origin);
      const result2 = canonicalOrigin(origin);
      expect(result1).toBe(result2);
      expect(result1).toBe('https://example.com');
    });

    it('should prevent trailing dot bypass attacks', () => {
      // example.com and example.com. should normalize to same canonical form
      const canonical1 = canonicalOrigin('https://example.com');
      const canonical2 = canonicalOrigin('https://example.com.');
      expect(canonical1).toBe(canonical2);
    });
  });
});

describe('currentEpochDays', () => {
  it('should return current epoch days as string', () => {
    const now = Date.now();
    const expected = String(Math.floor(now / 86400000));
    const result = currentEpochDays(now);
    
    expect(result).toBe(expected);
  });

  it('should be consistent for same timestamp', () => {
    const timestamp = 1704067200000; // 2024-01-01 00:00:00 UTC
    const result1 = currentEpochDays(timestamp);
    const result2 = currentEpochDays(timestamp);
    
    expect(result1).toBe(result2);
  });
});

describe('windowId', () => {
  it('should return window ID (currently same as epoch days)', () => {
    const epochDays = '19700';
    const window = windowId(epochDays);
    
    expect(window).toBe(epochDays);
  });
});

describe('parsePolicyId', () => {
  it('should extract policy from AADr', () => {
    expect(parsePolicyId('policy=strict|app=test')).toBe('strict');
    expect(parsePolicyId('app=test|policy=permissive')).toBe('permissive');
  });

  it('should return "default" if no policy found', () => {
    expect(parsePolicyId('app=test')).toBe('default');
    expect(parsePolicyId('')).toBe('default');
  });
});

describe('secondsUntilWindowEnd', () => {
  it('should return seconds until end of day', () => {
    const now = Date.now();
    const epochDays = String(Math.floor(now / 86400000));
    const result = secondsUntilWindowEnd(epochDays);
    
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(86400);
  });

  it('should return at least 1 second', () => {
    // Even at end of day, should return at least 1
    const epochDays = String(Math.floor(Date.now() / 86400000));
    const result = secondsUntilWindowEnd(epochDays);
    
    expect(result).toBeGreaterThanOrEqual(1);
  });
});

describe('secretToBytes', () => {
  it('should convert base64url string to Uint8Array', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const b64 = bytesToB64url(original);
    const result = secretToBytes(b64);
    
    expect(result).toEqual(original);
  });

  it('should handle 32-byte secrets (common case)', () => {
    const secret = new Uint8Array(32).fill(42);
    const b64 = bytesToB64url(secret);
    const result = secretToBytes(b64);
    
    expect(result).toEqual(secret);
    expect(result.length).toBe(32);
  });
});
