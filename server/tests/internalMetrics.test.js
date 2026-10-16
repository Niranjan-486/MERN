const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');

describe('Internal Metrics Endpoint (GET /internal/metrics)', () => {
  const TEST_VALID_KEY = 'super-secret-simulator-key-12345';
  const origEnvKey = process.env.SIMULATOR_KEY;

  afterAll(() => {
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

  test('returns 404 when SIMULATOR_KEY is unset, even if header is sent', async () => {
    delete process.env.SIMULATOR_KEY;
    env.SIMULATOR_KEY = '';

    const res = await request(app)
      .get('/internal/metrics')
      .set('x-simulator-key', TEST_VALID_KEY);

    expect(res.status).toBe(404);
  });

  test('returns 404 when x-simulator-key header is missing', async () => {
    process.env.SIMULATOR_KEY = TEST_VALID_KEY;
    env.SIMULATOR_KEY = TEST_VALID_KEY;

    const res = await request(app).get('/internal/metrics');

    expect(res.status).toBe(404);
  });

  test('returns 404 when x-simulator-key header is incorrect', async () => {
    process.env.SIMULATOR_KEY = TEST_VALID_KEY;
    env.SIMULATOR_KEY = TEST_VALID_KEY;

    const res = await request(app)
      .get('/internal/metrics')
      .set('x-simulator-key', 'wrong-simulator-key-value');

    expect(res.status).toBe(404);
  });

  test('returns 200 with full metrics payload when valid simulator key is provided', async () => {
    process.env.SIMULATOR_KEY = TEST_VALID_KEY;
    env.SIMULATOR_KEY = TEST_VALID_KEY;

    const res = await request(app)
      .get('/internal/metrics')
      .set('x-simulator-key', TEST_VALID_KEY);

    expect(res.status).toBe(200);

    const data = res.body;

    // Verify shape
    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThanOrEqual(0);

    expect(typeof data.rssMB).toBe('number');
    expect(data.rssMB).toBeGreaterThan(0);

    expect(typeof data.heapUsedMB).toBe('number');
    expect(data.heapUsedMB).toBeGreaterThan(0);

    expect(typeof data.cpu).toBe('object');
    expect(typeof data.cpu.userMs).toBe('number');
    expect(typeof data.cpu.systemMs).toBe('number');

    expect(typeof data.eventLoopDelay).toBe('object');
    expect(typeof data.eventLoopDelay.p50).toBe('number');
    expect(typeof data.eventLoopDelay.p95).toBe('number');
    expect(typeof data.eventLoopDelay.p99).toBe('number');
    expect(typeof data.eventLoopDelay.max).toBe('number');

    expect(typeof data.connectedSockets).toBe('number');
    expect(data.connectedSockets).toBeGreaterThanOrEqual(0);

    expect(typeof data.jobQueue).toBe('object');
    expect(data.jobQueue).toHaveProperty('timers');
    expect(data.jobQueue).toHaveProperty('notify');

    expect(typeof data.jobsRunning).toBe('boolean');
  });
});
