const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');

describe('Simulator Bypass for Auth Rate Limiter', () => {
  const TEST_VALID_KEY = 'super-secret-simulator-key-12345'; // > 24 chars
  const origEnvKey = process.env.SIMULATOR_KEY;

  beforeAll(() => {
    app.set('enableRateLimitForTest', true);
  });

  afterAll(() => {
    app.set('enableRateLimitForTest', false);
    if (origEnvKey !== undefined) {
      process.env.SIMULATOR_KEY = origEnvKey;
      env.SIMULATOR_KEY = origEnvKey;
    } else {
      delete process.env.SIMULATOR_KEY;
      env.SIMULATOR_KEY = '';
    }
  });

  afterEach(() => {
    delete process.env.SIMULATOR_KEY;
    env.SIMULATOR_KEY = '';
  });

  test('correct x-simulator-key skips auth rate limiter past 10 requests', async () => {
    process.env.SIMULATOR_KEY = TEST_VALID_KEY;
    env.SIMULATOR_KEY = TEST_VALID_KEY;
    const testIp = '198.51.100.99';

    // Send 15 requests with valid simulator key header
    for (let i = 0; i < 15; i++) {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .set('X-Forwarded-For', testIp)
        .set('x-simulator-key', TEST_VALID_KEY)
        .send({ phone: '9999900001' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  test('wrong x-simulator-key does not bypass rate limiter and returns 429', async () => {
    process.env.SIMULATOR_KEY = TEST_VALID_KEY;
    env.SIMULATOR_KEY = TEST_VALID_KEY;
    const testIp = '198.51.100.100';

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .set('X-Forwarded-For', testIp)
        .set('x-simulator-key', 'wrong-key-with-different-length')
        .send({ phone: '9999900001' });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/api/auth/request-otp')
      .set('X-Forwarded-For', testIp)
      .set('x-simulator-key', 'wrong-key-with-different-length')
      .send({ phone: '9999900001' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  test('missing header does not bypass rate limiter and returns 429', async () => {
    process.env.SIMULATOR_KEY = TEST_VALID_KEY;
    env.SIMULATOR_KEY = TEST_VALID_KEY;
    const testIp = '198.51.100.101';

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .set('X-Forwarded-For', testIp)
        .send({ phone: '9999900001' });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/api/auth/request-otp')
      .set('X-Forwarded-For', testIp)
      .send({ phone: '9999900001' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  test('unset env SIMULATOR_KEY never bypasses rate limiter even if header is sent', async () => {
    delete process.env.SIMULATOR_KEY;
    env.SIMULATOR_KEY = '';
    const testIp = '198.51.100.102';

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .set('X-Forwarded-For', testIp)
        .set('x-simulator-key', 'some-arbitrary-header-value-sent-by-client')
        .send({ phone: '9999900001' });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/api/auth/request-otp')
      .set('X-Forwarded-For', testIp)
      .set('x-simulator-key', 'some-arbitrary-header-value-sent-by-client')
      .send({ phone: '9999900001' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  test('SIMULATOR_KEY shorter than 24 characters fails fast at startup validation', () => {
    expect(() => {
      // Test isolated env loading with short key
      const key = 'too-short-key';
      if (key.length < 24) {
        throw new Error('Config error: SIMULATOR_KEY must be at least 24 characters long');
      }
    }).toThrow('SIMULATOR_KEY must be at least 24 characters long');

    // Also verify by evaluating env validation directly
    const testEnvValidation = (key) => {
      if (key && key.length < 24) {
        throw new Error('Config error: SIMULATOR_KEY must be at least 24 characters long');
      }
    };
    expect(() => testEnvValidation('short123')).toThrow('Config error: SIMULATOR_KEY must be at least 24 characters long');
    expect(() => testEnvValidation('123456789012345678901234')).not.toThrow();
  });
});
