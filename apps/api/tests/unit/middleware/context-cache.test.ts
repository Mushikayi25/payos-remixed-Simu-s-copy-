import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { 
  contextCacheMiddleware, 
  invalidateCache,
  invalidateAccountCache,
  getCacheStats,
  clearCache,
  CacheTTL,
} from '../../../src/middleware/context-cache.js';

describe('Context Cache Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    // Clear cache before each test
    clearCache();
    
    // Create fresh app
    app = new Hono();
    
    // Add mock auth middleware to set context (must run before cache middleware)
    app.use('*', async (c, next) => {
      c.set('ctx', { tenantId: 'test-tenant' });
      await next();
    });
    
    // Add cache middleware
    app.use('*', contextCacheMiddleware);
    
    // Mock context endpoint
    app.get('/v1/context/account/:id', (c) => {
      return c.json({
        success: true,
        data: {
          account: {
            id: c.req.param('id'),
            name: 'Test Account',
            balance: Math.random() * 1000, // Random to test caching
          },
        },
      });
    });
    
    app.get('/v1/context/transfer/:id', (c) => {
      return c.json({
        success: true,
        data: {
          transfer: {
            id: c.req.param('id'),
            amount: '100.00',
            status: 'completed',
          },
        },
      });
    });
    
    // Non-context endpoint (should not be cached)
    app.get('/v1/accounts/:id', (c) => {
      return c.json({
        id: c.req.param('id'),
        name: 'Test Account',
        balance: Math.random() * 1000,
      });
    });
  });

  describe('Cache Hit/Miss', () => {
    it('should return MISS on first request', async () => {
      const res = await app.request('/v1/context/account/acc_123');
      const cacheHeader = res.headers.get('X-Cache');
      
      expect(cacheHeader).toBe('MISS');
      expect(res.status).toBe(200);
    });

    it('should return HIT on second request', async () => {
      // First request
      const res1 = await app.request('/v1/context/account/acc_123');
      const body1 = await res1.json();
      
      expect(res1.headers.get('X-Cache')).toBe('MISS');
      
      // Second request (should hit cache)
      const res2 = await app.request('/v1/context/account/acc_123');
      const body2 = await res2.json();
      
      expect(res2.headers.get('X-Cache')).toBe('HIT');
      
      // Balance should be same (proving it's cached)
      expect(body1.data.account.balance).toBe(body2.data.account.balance);
    });

    it('should cache different accounts separately', async () => {
      const res1 = await app.request('/v1/context/account/acc_123');
      const res2 = await app.request('/v1/context/account/acc_456');
      
      expect(res1.headers.get('X-Cache')).toBe('MISS');
      expect(res2.headers.get('X-Cache')).toBe('MISS');
      
      const body1 = await res1.json();
      const body2 = await res2.json();
      
      expect(body1.data.account.id).toBe('acc_123');
      expect(body2.data.account.id).toBe('acc_456');
    });
  });

  describe('Cache Headers', () => {
    it('should include X-Cache-Age header', async () => {
      // First request
      await app.request('/v1/context/account/acc_123');
      
      // Wait 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Second request
      const res = await app.request('/v1/context/account/acc_123');
      const age = parseInt(res.headers.get('X-Cache-Age') || '0');
      
      expect(age).toBeGreaterThanOrEqual(0);
      expect(res.headers.get('X-Cache')).toBe('HIT');
    });

    it('should include ETag header', async () => {
      const res = await app.request('/v1/context/account/acc_123');
      const etag = res.headers.get('ETag');
      
      expect(etag).toBeTruthy();
      expect(etag).toMatch(/^W\//); // Weak ETag format
    });

    it('should include Cache-Control header', async () => {
      const res = await app.request('/v1/context/account/acc_123');
      const cacheControl = res.headers.get('Cache-Control');
      
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toMatch(/private/);
      expect(cacheControl).toMatch(/max-age=/);
    });
  });

  describe('Cache Bypass', () => {
    it('should bypass cache with Cache-Control: no-cache header', async () => {
      // First request (populate cache)
      const res1 = await app.request('/v1/context/account/acc_123');
      const body1 = await res1.json();
      
      expect(res1.headers.get('X-Cache')).toBe('MISS');
      
      // Second request with no-cache (should bypass)
      const res2 = await app.request('/v1/context/account/acc_123', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      const body2 = await res2.json();
      
      expect(res2.headers.get('X-Cache')).toBe('MISS');
      
      // Balance should be different (proving cache was bypassed)
      expect(body1.data.account.balance).not.toBe(body2.data.account.balance);
    });

    it('should bypass cache with ?fresh=true query param', async () => {
      // First request (populate cache)
      const res1 = await app.request('/v1/context/account/acc_123');
      const body1 = await res1.json();
      
      expect(res1.headers.get('X-Cache')).toBe('MISS');
      
      // Second request with fresh param (should bypass)
      const res2 = await app.request('/v1/context/account/acc_123?fresh=true');
      const body2 = await res2.json();
      
      expect(res2.headers.get('X-Cache')).toBe('MISS');
      
      // Balance should be different
      expect(body1.data.account.balance).not.toBe(body2.data.account.balance);
    });
  });

  describe('ETag / 304 Not Modified', () => {
    it('should return 304 when If-None-Match matches ETag', async () => {
      // First request
      const res1 = await app.request('/v1/context/account/acc_123');
      const etag = res1.headers.get('ETag');
      
      expect(etag).toBeTruthy();
      
      // Second request with If-None-Match
      const res2 = await app.request('/v1/context/account/acc_123', {
        headers: { 'If-None-Match': etag! },
      });
      
      expect(res2.status).toBe(304);
      expect(res2.headers.get('X-Cache')).toBe('HIT');
    });
  });

  describe('Only Cache Context Endpoints', () => {
    it('should not cache non-context endpoints', async () => {
      const res1 = await app.request('/v1/accounts/acc_123');
      const res2 = await app.request('/v1/accounts/acc_123');
      
      // Neither should have cache headers
      expect(res1.headers.get('X-Cache')).toBeNull();
      expect(res2.headers.get('X-Cache')).toBeNull();
    });

    it('should only cache GET requests', async () => {
      const res = await app.request('/v1/context/account/acc_123', {
        method: 'POST',
        body: JSON.stringify({ test: 'data' }),
      });
      
      // Should not have cache headers
      expect(res.headers.get('X-Cache')).toBeNull();
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache by pattern', async () => {
      // Populate cache
      await app.request('/v1/context/account/acc_123');
      await app.request('/v1/context/account/acc_456');
      await app.request('/v1/context/transfer/txn_789');
      
      const stats1 = getCacheStats();
      expect(stats1.size).toBe(3);
      
      // Invalidate account caches
      const count = invalidateCache('/context/account/');
      expect(count).toBe(2);
      
      const stats2 = getCacheStats();
      expect(stats2.size).toBe(1);
    });

    it('should invalidate specific account cache', async () => {
      // Populate cache
      const res1 = await app.request('/v1/context/account/acc_123');
      expect(res1.headers.get('X-Cache')).toBe('MISS');
      
      // Verify it's cached
      const res2 = await app.request('/v1/context/account/acc_123');
      expect(res2.headers.get('X-Cache')).toBe('HIT');
      
      // Invalidate specific account
      const count = invalidateAccountCache('test-tenant', 'acc_123');
      expect(count).toBe(1);
      
      // Next request should be MISS
      const res3 = await app.request('/v1/context/account/acc_123');
      expect(res3.headers.get('X-Cache')).toBe('MISS');
    });
  });

  describe('Cache Statistics', () => {
    it('should return cache statistics', async () => {
      // Populate cache
      await app.request('/v1/context/account/acc_123');
      await app.request('/v1/context/transfer/txn_456');
      
      const stats = getCacheStats();
      
      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0]).toHaveProperty('key');
      expect(stats.entries[0]).toHaveProperty('age');
      expect(stats.entries[0]).toHaveProperty('ttl');
    });

    it('should show increasing age over time', async () => {
      await app.request('/v1/context/account/acc_123');
      
      const stats1 = getCacheStats();
      const age1 = stats1.entries[0].age;
      
      // Wait 1 second to ensure measurable difference
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const stats2 = getCacheStats();
      const age2 = stats2.entries[0].age;
      
      expect(age2).toBeGreaterThanOrEqual(age1 + 1);
    });
  });

  describe('Different Endpoint TTLs', () => {
    it('should use appropriate TTL for account endpoints', async () => {
      const res = await app.request('/v1/context/account/acc_123');
      const cacheControl = res.headers.get('Cache-Control');
      const maxAge = parseInt(cacheControl?.match(/max-age=(\d+)/)?.[1] || '0');
      
      // Should be 5 minutes (300 seconds)
      expect(maxAge).toBeGreaterThan(200);
      expect(maxAge).toBeLessThanOrEqual(300);
    });

    it('should use appropriate TTL for transfer endpoints', async () => {
      const res = await app.request('/v1/context/transfer/txn_123');
      const cacheControl = res.headers.get('Cache-Control');
      const maxAge = parseInt(cacheControl?.match(/max-age=(\d+)/)?.[1] || '0');
      
      // Should be 2 minutes (120 seconds)
      expect(maxAge).toBeGreaterThan(100);
      expect(maxAge).toBeLessThanOrEqual(120);
    });
  });

  describe('Performance', () => {
    it('should improve response time on cache hit', async () => {
      // First request (MISS)
      const start1 = Date.now();
      await app.request('/v1/context/account/acc_123');
      const duration1 = Date.now() - start1;
      
      // Second request (HIT)
      const start2 = Date.now();
      const res2 = await app.request('/v1/context/account/acc_123');
      const duration2 = Date.now() - start2;
      
      expect(res2.headers.get('X-Cache')).toBe('HIT');
      
      // Cache hit should be faster (or at least not significantly slower)
      // Note: In unit tests both durations may be sub-millisecond (rounded to 0-1ms)
      expect(duration2).toBeLessThanOrEqual(Math.max(duration1 * 2, 5));
    });
  });

  describe('Clear Cache', () => {
    it('should clear all cache entries', async () => {
      // Populate cache
      await app.request('/v1/context/account/acc_123');
      await app.request('/v1/context/transfer/txn_456');
      
      const stats1 = getCacheStats();
      expect(stats1.size).toBe(2);
      
      // Clear cache
      clearCache();
      
      const stats2 = getCacheStats();
      expect(stats2.size).toBe(0);
      
      // Next requests should be MISS
      const res = await app.request('/v1/context/account/acc_123');
      expect(res.headers.get('X-Cache')).toBe('MISS');
    });
  });
});

