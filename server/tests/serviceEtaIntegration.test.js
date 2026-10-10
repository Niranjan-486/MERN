const mongoose = require('mongoose');
const http = require('http');
const request = require('supertest');
const { io: ClientSocket } = require('socket.io-client');
const app = require('../src/app');
const { createRealtime } = require('../src/realtime');
const { Organization, Service, Counter, User, Token, TokenSequence } = require('../src/models');
const queueService = require('../src/services/queueService');
const { signToken } = require('../src/middleware/auth');

const TEST_MONGO_URI = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

jest.setTimeout(45000);

let server;
let ioInstance;
let serverPort;

function createClientSocket(token) {
  return ClientSocket(`http://localhost:${serverPort}`, {
    auth: { token },
    transports: ['websocket'],
    autoConnect: true,
  });
}

function waitForEvent(socket, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${eventName}" after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeAll(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  await Promise.all([
    Organization.syncIndexes(),
    Service.syncIndexes(),
    Counter.syncIndexes(),
    User.syncIndexes(),
    Token.syncIndexes(),
    TokenSequence.syncIndexes(),
  ]);

  server = http.createServer(app);
  ioInstance = createRealtime(server);
  await new Promise((resolve) => {
    server.listen(0, () => {
      serverPort = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (ioInstance && ioInstance.cleanup) ioInstance.cleanup();
  if (ioInstance) await ioInstance.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.close();
});

beforeEach(async () => {
  await Promise.all([
    Organization.deleteMany({}),
    Service.deleteMany({}),
    Counter.deleteMany({}),
    User.deleteMany({}),
    Token.deleteMany({}),
    TokenSequence.deleteMany({}),
  ]);
});

describe('Phase 1: Service-Time EWMA Tracking & Wait-Time ETA Integration Tests', () => {
  // 1. EWMA rules (ignored sample, capped sample, weights for first 5 samples)
  test('EWMA rules: ignored sample, 3x capped sample, and exact weights for first 5 samples', async () => {
    const org = await Organization.create({ name: 'Hospital EWMA', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'General OPD',
      avgServiceTimeSec: 300,
      serviceSamples: 0,
    });

    // Rule A: Ignored sample (< 10 s leaves avg and samples completely unchanged)
    await queueService.updateServiceAvgEWMA(service._id, 9);
    await queueService.updateServiceAvgEWMA(service._id, 5);
    let s = await Service.findById(service._id);
    expect(s.avgServiceTimeSec).toBe(300);
    expect(s.serviceSamples).toBe(0);

    // Rule B: Weights for first 5 samples
    // Sample 1: sample = 200s.
    // serviceSamples = 0 -> weight = max(0.2, 1 / (0 + 2)) = 0.5
    // newAvg = 300 * (1 - 0.5) + 200 * 0.5 = 150 + 100 = 250.
    await queueService.updateServiceAvgEWMA(service._id, 200);
    s = await Service.findById(service._id);
    expect(s.serviceSamples).toBe(1);
    expect(s.avgServiceTimeSec).toBeCloseTo(250, 4);

    // Sample 2: sample = 100s.
    // serviceSamples = 1 -> weight = max(0.2, 1 / (1 + 2)) = 1/3 (0.3333...)
    // newAvg = 250 * (2/3) + 100 * (1/3) = 500/3 + 100/3 = 600/3 = 200.
    await queueService.updateServiceAvgEWMA(service._id, 100);
    s = await Service.findById(service._id);
    expect(s.serviceSamples).toBe(2);
    expect(s.avgServiceTimeSec).toBeCloseTo(200, 4);

    // Sample 3: sample = 400s.
    // serviceSamples = 2 -> weight = max(0.2, 1 / (2 + 2)) = 0.25 (1/4)
    // newAvg = 200 * 0.75 + 400 * 0.25 = 150 + 100 = 250.
    await queueService.updateServiceAvgEWMA(service._id, 400);
    s = await Service.findById(service._id);
    expect(s.serviceSamples).toBe(3);
    expect(s.avgServiceTimeSec).toBeCloseTo(250, 4);

    // Sample 4: sample = 250s.
    // serviceSamples = 3 -> weight = max(0.2, 1 / (3 + 2)) = 0.2 (1/5)
    // newAvg = 250 * 0.8 + 250 * 0.2 = 250.
    await queueService.updateServiceAvgEWMA(service._id, 250);
    s = await Service.findById(service._id);
    expect(s.serviceSamples).toBe(4);
    expect(s.avgServiceTimeSec).toBeCloseTo(250, 4);

    // Sample 5: sample = 150s.
    // serviceSamples = 4 -> 1 / (4 + 2) = 1/6 (~0.1667) -> weight = max(0.2, 1/6) = 0.2 (floored at 0.2)
    // newAvg = 250 * 0.8 + 150 * 0.2 = 200 + 30 = 230.
    await queueService.updateServiceAvgEWMA(service._id, 150);
    s = await Service.findById(service._id);
    expect(s.serviceSamples).toBe(5);
    expect(s.avgServiceTimeSec).toBeCloseTo(230, 4);

    // Rule C: Capped sample at 3x current average
    // Current avg is 230 -> 3x is 690.
    // If a sample is 1500s (e.g. staff forgot to click Complete), it is capped at 690s.
    // weight = max(0.2, 1 / (5 + 2)) = 0.2
    // newAvg = 230 * 0.8 + 690 * 0.2 = 184 + 138 = 322.
    await queueService.updateServiceAvgEWMA(service._id, 1500);
    s = await Service.findById(service._id);
    expect(s.serviceSamples).toBe(6);
    expect(s.avgServiceTimeSec).toBeCloseTo(322, 4);
  });

  // 2. 50 completions in parallel: exactly 50 samples (no lost updates), avg between min and max sample
  test('50 completions in parallel leave serviceSamples at exactly 50 with no lost updates', async () => {
    const org = await Organization.create({ name: 'Hospital Parallel', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD Parallel',
      avgServiceTimeSec: 200,
      serviceSamples: 0,
    });

    const now = Date.now();
    const counters = await Counter.insertMany(
      Array.from({ length: 50 }, (_, i) => ({
        serviceId: service._id,
        name: `Counter ${i + 1}`,
        status: 'active',
      }))
    );

    const users = await User.insertMany(
      Array.from({ length: 50 }, (_, i) => ({
        phone: `+919700000${String(i).padStart(3, '0')}`,
        name: `User ${i + 1}`,
        role: 'patient',
      }))
    );

    // Create 50 serving tokens with varying durations between 100s and 300s
    const tokens = await Token.insertMany(
      Array.from({ length: 50 }, (_, i) => {
        const durationSec = 100 + (i * 4); // Between 100s and 296s
        return {
          serviceId: service._id,
          userId: users[i]._id,
          number: i + 1,
          queueDate: '2026-10-10',
          status: 'serving',
          priority: 0,
          counterId: counters[i]._id,
          isActive: true,
          isHoldingCounter: true,
          servingAt: new Date(now - durationSec * 1000),
        };
      })
    );

    // Execute 50 completeToken operations concurrently
    const completionPromises = tokens.map((t, idx) =>
      queueService.completeToken({ tokenId: t._id, counterId: counters[idx]._id })
    );

    await Promise.all(completionPromises);

    const updatedService = await Service.findById(service._id);
    // Strict atomic increment check: no lost updates!
    expect(updatedService.serviceSamples).toBe(50);
    // Average must strictly lie between the smallest sample (100) and the largest sample (296)
    expect(updatedService.avgServiceTimeSec).toBeGreaterThanOrEqual(100);
    expect(updatedService.avgServiceTimeSec).toBeLessThanOrEqual(300);
  });

  // 3. Snapshot ETAs equal getTokenStatus ETAs
  test('snapshot ETAs equal getTokenStatus ETAs for all waiting tokens', async () => {
    const org = await Organization.create({ name: 'Hospital ETA Agree', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD ETA',
      avgServiceTimeSec: 300,
    });

    // 2 active counters: Counter 1 idle, Counter 2 currently serving a patient 60s in
    const c1 = await Counter.create({ serviceId: service._id, name: 'Counter 1', status: 'active' });
    const c2 = await Counter.create({ serviceId: service._id, name: 'Counter 2', status: 'active' });

    const activeUser = await User.create({ phone: '919888888000', name: 'Serving User', role: 'patient' });
    const activeToken = await queueService.joinQueue({
      serviceId: service._id,
      userId: activeUser._id,
      priority: 0,
    });
    await queueService.callNext({ counterId: c2._id });
    await queueService.startServing({ tokenId: activeToken._id, counterId: c2._id });
    // Set servingAt to 60s ago to simulate ongoing consultation
    await Token.updateOne({ _id: activeToken._id }, { servingAt: new Date(Date.now() - 60 * 1000) });

    const waitingUsers = await User.insertMany(
      Array.from({ length: 6 }, (_, i) => ({
        phone: `91988888800${i + 1}`,
        name: `Wait User ${i + 1}`,
        role: 'patient',
      }))
    );

    const waitingTokens = [];
    for (let i = 0; i < waitingUsers.length; i++) {
      const priority = i % 3; // mix of 0, 1, 2
      const t = await queueService.joinQueue({
        serviceId: service._id,
        userId: waitingUsers[i]._id,
        priority,
      });
      waitingTokens.push(t);
    }

    const snapshot = await queueService.getQueueSnapshot(service._id, '2026-10-10');
    expect(snapshot.waitingTokens).toHaveLength(6);

    // Verify snapshot ETAs match getTokenStatus ETAs exactly
    for (let idx = 0; idx < snapshot.waitingTokens.length; idx++) {
      const snapToken = snapshot.waitingTokens[idx];
      const statusInfo = await queueService.getTokenStatus(snapToken._id);

      expect(typeof snapToken.etaSeconds).toBe('number');
      expect(statusInfo.etaSeconds).toBe(snapToken.etaSeconds);
      expect(statusInfo.peopleAhead).toBe(idx);
    }
  });

  // 4. Realtime payloads carry etaSeconds
  test('realtime token:updated payloads carry etaSeconds (number while waiting, null otherwise)', async () => {
    const org = await Organization.create({ name: 'Hospital Realtime', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD RT',
      avgServiceTimeSec: 300,
    });
    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Counter RT',
      status: 'active',
    });

    const patient = await User.create({
      phone: '919555555001',
      name: 'RT Patient',
      role: 'patient',
    });

    const socket = createClientSocket(signToken(patient));
    await new Promise((resolve) => socket.once('connect', resolve));

    // A. Join queue -> wait for token:updated
    const joinPromise = waitForEvent(socket, 'token:updated');
    const token = await queueService.joinQueue({
      serviceId: service._id,
      userId: patient._id,
      priority: 0,
    });
    const joinPayload = await joinPromise;

    expect(joinPayload.status).toBe('waiting');
    expect(typeof joinPayload.etaSeconds).toBe('number');
    expect(joinPayload.peopleAhead).toBe(0);

    // B. Call next -> token:updated should have etaSeconds: null
    const callPromise = waitForEvent(socket, 'token:updated');
    await queueService.callNext({ counterId: counter._id });
    const callPayload = await callPromise;

    expect(callPayload.status).toBe('called');
    expect(callPayload.etaSeconds).toBeNull();
    expect(callPayload.counterName).toBe('Counter RT');

    // C. Start serving -> token:updated should have etaSeconds: null
    const startPromise = waitForEvent(socket, 'token:updated');
    await queueService.startServing({ tokenId: token._id, counterId: counter._id });
    const startPayload = await startPromise;

    expect(startPayload.status).toBe('serving');
    expect(startPayload.etaSeconds).toBeNull();

    // D. Complete -> token:updated should have etaSeconds: null
    const completePromise = waitForEvent(socket, 'token:updated');
    await queueService.completeToken({ tokenId: token._id, counterId: counter._id });
    const completePayload = await completePromise;

    expect(completePayload.status).toBe('completed');
    expect(completePayload.etaSeconds).toBeNull();

    socket.disconnect();
  });

  // 5. REST Endpoints include etaSeconds and avgServiceSec
  test('REST endpoints: GET /api/tokens/:id, GET /api/me/tokens/active, and GET /api/counters/:id/dashboard', async () => {
    const org = await Organization.create({ name: 'Hospital REST', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD REST',
      avgServiceTimeSec: 240,
    });
    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Counter 1',
      status: 'active',
    });

    const patient = await User.create({
      phone: '919333333001',
      name: 'REST Patient',
      role: 'patient',
    });
    const staff = await User.create({
      phone: '919333333000',
      name: 'Staff REST',
      role: 'staff',
      organizationId: org._id,
    });

    const patientJwt = signToken(patient);
    const staffJwt = signToken(staff);

    const token = await queueService.joinQueue({
      serviceId: service._id,
      userId: patient._id,
      priority: 0,
    });

    // A. GET /api/tokens/:id
    const tokenRes = await request(app)
      .get(`/api/tokens/${token._id}`)
      .set('Authorization', `Bearer ${patientJwt}`);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.etaSeconds).toBe(0);
    expect(tokenRes.body.token.etaSeconds).toBe(0);

    // B. GET /api/me/tokens/active
    const activeRes = await request(app)
      .get('/api/me/tokens/active')
      .set('Authorization', `Bearer ${patientJwt}`);
    expect(activeRes.status).toBe(200);
    expect(activeRes.body).toHaveLength(1);
    expect(activeRes.body[0].etaSeconds).toBe(0);

    // C. GET /api/counters/:counterId/dashboard
    const dashRes = await request(app)
      .get(`/api/counters/${counter._id}/dashboard`)
      .set('Authorization', `Bearer ${staffJwt}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.service.avgServiceSec).toBe(240);
    expect(dashRes.body.waiting).toHaveLength(1);
    expect(dashRes.body.waiting[0].etaSeconds).toBe(0);
  });
});
