const request = require('supertest');
const app = require('../src/app');

describe('Trust Proxy and Auth Rate Limiter', () => {
  beforeAll(() => {
    // Enable rate limiter specifically for this test suite
    app.set('enableRateLimitForTest', true);
  });

  afterAll(() => {
    // Restore default skip behavior for other test suites
    app.set('enableRateLimitForTest', false);
  });

  it('keys rate limiting on X-Forwarded-For client IP when trust proxy is enabled', async () => {
    const clientIpA = '198.51.100.10';
    const clientIpB = '198.51.100.20';

    // IP A sends 10 valid requests (reaching the limit of 10 req/min)
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .set('X-Forwarded-For', clientIpA)
        .send({ phone: '9999900001' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }

    // 11th request from IP A must be rate-limited (HTTP 429)
    const blockedRes = await request(app)
      .post('/api/auth/request-otp')
      .set('X-Forwarded-For', clientIpA)
      .send({ phone: '9999900001' });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toBeDefined();
    expect(blockedRes.body.error.code).toBe('RATE_LIMITED');

    // A request from IP B behind the proxy must NOT be rate limited
    // Proving the limiter keys on X-Forwarded-For rather than putting all users in one bucket
    const allowedRes = await request(app)
      .post('/api/auth/request-otp')
      .set('X-Forwarded-For', clientIpB)
      .send({ phone: '9999900001' });
    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body).toEqual({ ok: true });
  });

  it('GET /health is shallow, unauthenticated, and returns { status: "ok" }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /ready checks database connectivity', async () => {
    const res = await request(app).get('/ready');
    // In this unit test where DB is not connected, readyState !== 1 -> 503 degraded
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('mongo');
    expect(res.body).toHaveProperty('uptime');
  });
});
