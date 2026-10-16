const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const env = require('../src/config/env');
const { createRealtime } = require('../src/realtime');
const { Organization, Service, Counter, User, Token, TokenSequence, Notification, PushSubscription } = require('../src/models');
const { getQueueDate } = require('../src/utils/queueDate');
const { calculatePercentiles } = require('../tools/sim/percentile');
const { ConvergenceTracker, calculateConvergenceTime } = require('../tools/sim/convergence');
const { prepareService, cleanupSimData } = require('../tools/sim/db');
const { runBurst } = require('../tools/sim/runner');

const TEST_MONGO_URI = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

jest.setTimeout(45000);

describe('Patient Simulator Test Suite', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(TEST_MONGO_URI);
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  });

  describe('1. Percentile Helper (calculatePercentiles)', () => {
    test('handles empty or invalid arrays gracefully', () => {
      expect(calculatePercentiles([])).toEqual({
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
      });
      expect(calculatePercentiles(null)).toEqual({
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
      });
    });

    test('calculates correct statistics for a single element', () => {
      const res = calculatePercentiles([42]);
      expect(res.count).toBe(1);
      expect(res.min).toBe(42);
      expect(res.max).toBe(42);
      expect(res.avg).toBe(42);
      expect(res.p50).toBe(42);
      expect(res.p90).toBe(42);
      expect(res.p95).toBe(42);
      expect(res.p99).toBe(42);
    });

    test('calculates accurate percentiles and summary stats for 10 sorted values', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const res = calculatePercentiles(values);

      expect(res.count).toBe(10);
      expect(res.min).toBe(10);
      expect(res.max).toBe(100);
      expect(res.avg).toBe(55);
      expect(res.p50).toBe(55);
      expect(res.p90).toBe(91);
      expect(res.p95).toBe(95.5);
      expect(res.p99).toBe(99.1);
    });
  });

  describe('2. Convergence Calculation Helper', () => {
    test('ConvergenceTracker tracks event arrivals and convergence time', () => {
      const startTime = 1000;
      const tracker = new ConvergenceTracker(
        [
          { userId: 'u1', expectedPeopleAhead: 0 },
          { userId: 'u2', expectedPeopleAhead: 1 },
        ],
        startTime
      );

      expect(tracker.isConverged()).toBe(false);

      // Intermediate event (u2 receives peopleAhead: 0 before batch update)
      tracker.recordEvent('u2', { peopleAhead: 0 }, 1050);
      expect(tracker.isConverged()).toBe(false);

      // Final event for u1 (peopleAhead: 0 at t=1100)
      tracker.recordEvent('u1', { peopleAhead: 0 }, 1100);
      expect(tracker.isConverged()).toBe(false);

      // Final event for u2 (peopleAhead: 1 at t=1250)
      tracker.recordEvent('u2', { peopleAhead: 1 }, 1250);
      expect(tracker.isConverged()).toBe(true);
      expect(tracker.getConvergenceTime()).toBe(250); // 1250 - 1000 = 250ms
    });

    test('calculateConvergenceTime computes correct delta from timestamps', () => {
      expect(calculateConvergenceTime([], 1000)).toBe(0);
      expect(calculateConvergenceTime([1020, 1080, 1250], 1000)).toBe(250);
    });
  });

  describe('3. Database Tools (sim:db prepare & cleanup)', () => {
    beforeEach(async () => {
      await Promise.all([
        Organization.deleteMany({}),
        Service.deleteMany({}),
        Counter.deleteMany({}),
        User.deleteMany({}),
        Token.deleteMany({}),
        TokenSequence.deleteMany({}),
        Notification.deleteMany({}),
        PushSubscription.deleteMany({}),
      ]);
    });

    test('prepareService updates avgServiceTimeSec and serviceSamples to 5', async () => {
      const org = await Organization.create({ name: 'City Hospital', type: 'hospital' });
      const service = await Service.create({
        organizationId: org._id,
        name: 'General OPD',
        avgServiceTimeSec: 300,
        serviceSamples: 0,
      });

      const res = await prepareService({ avg: 150 });
      expect(res.serviceName).toBe('General OPD');
      expect(res.avgServiceTimeSec).toBe(150);
      expect(res.serviceSamples).toBe(5);

      const updated = await Service.findById(service._id);
      expect(updated.avgServiceTimeSec).toBe(150);
      expect(updated.serviceSamples).toBe(5);
    });

    test('cleanupSimData removes simulated records and refuses --reset-numbering when real tokens exist today', async () => {
      const today = getQueueDate();
      const org = await Organization.create({ name: 'City Hospital', type: 'hospital' });
      const service = await Service.create({
        organizationId: org._id,
        name: 'General OPD',
        avgServiceTimeSec: 180,
        serviceSamples: 5,
      });

      // 1. Create a real patient with a token today
      const realUser = await User.create({
        phone: '9999900001',
        name: 'Real Patient',
        role: 'patient',
      });
      const realToken = await Token.create({
        userId: realUser._id,
        serviceId: service._id,
        number: 1,
        queueDate: today,
        status: 'waiting',
      });

      // 2. Create simulated patients with tokens, notifications, push subs
      const simUser1 = await User.create({
        phone: '0000000001',
        name: 'Sim Patient 001',
        role: 'patient',
      });
      const simUser2 = await User.create({
        phone: '0000000002',
        name: 'Sim Patient 002',
        role: 'patient',
      });

      await Token.create([
        {
          userId: simUser1._id,
          serviceId: service._id,
          number: 2,
          queueDate: today,
          status: 'waiting',
        },
        {
          userId: simUser2._id,
          serviceId: service._id,
          number: 3,
          queueDate: today,
          status: 'waiting',
        },
      ]);

      await Notification.create({
        userId: simUser1._id,
        tokenId: realToken._id,
        serviceId: service._id,
        queueDate: today,
        kind: 'called',
        title: 'Your turn',
        body: 'Please proceed',
      });

      await PushSubscription.create({
        userId: simUser1._id,
        endpoint: 'https://push.example.com/sim1',
        keys: { p256dh: 'test', auth: 'test' },
      });

      await TokenSequence.create({
        serviceId: service._id,
        queueDate: today,
        seq: 3,
      });

      // 3. Run cleanup with resetNumbering: true
      const cleanupResult = await cleanupSimData({ resetNumbering: true });

      // Verifications:
      // A. Simulated users removed
      expect(cleanupResult.deletedUsersCount).toBe(2);
      expect(cleanupResult.deletedTokensCount).toBe(2);
      expect(cleanupResult.deletedNotificationsCount).toBe(1);
      expect(cleanupResult.deletedPushSubsCount).toBe(1);

      // B. Real patient and real token preserved
      const remainingRealUser = await User.findById(realUser._id);
      expect(remainingRealUser).not.toBeNull();
      const remainingRealToken = await Token.findById(realToken._id);
      expect(remainingRealToken).not.toBeNull();

      // C. --reset-numbering refused because a real token exists
      expect(cleanupResult.resetNumberingResult).toBe('refused_real_tokens_exist');
      const sequenceDoc = await TokenSequence.findOne({ serviceId: service._id, queueDate: today });
      expect(sequenceDoc).not.toBeNull();
      expect(sequenceDoc.seq).toBe(3);

      // D. Service ETA baseline reset to 300s, 0 samples
      const resetService = await Service.findById(service._id);
      expect(resetService.avgServiceTimeSec).toBe(300);
      expect(resetService.serviceSamples).toBe(0);

      // 4. Now delete real token and run cleanup again: sequence MUST be deleted
      await Token.deleteMany({});
      const secondCleanup = await cleanupSimData({ resetNumbering: true });
      expect(secondCleanup.resetNumberingResult).toBe('deleted');
      const sequenceAfter = await TokenSequence.findOne({ serviceId: service._id, queueDate: today });
      expect(sequenceAfter).toBeNull();
    });
  });

  describe('4. In-process End-to-End Burst Simulation (20 Patients)', () => {
    let httpServer;
    let ioServer;
    let serverUrl;
    const SIM_KEY = 'valid-simulator-key-for-test-24ch';

    beforeAll(async () => {
      process.env.SIMULATOR_KEY = SIM_KEY;
      env.SIMULATOR_KEY = SIM_KEY;

      await Promise.all([
        Organization.syncIndexes(),
        Service.syncIndexes(),
        Counter.syncIndexes(),
        User.syncIndexes(),
        Token.syncIndexes(),
        TokenSequence.syncIndexes(),
      ]);

      httpServer = http.createServer(app);
      ioServer = createRealtime(httpServer);
      await new Promise((resolve) => httpServer.listen(0, resolve));
      const port = httpServer.address().port;
      serverUrl = `http://localhost:${port}`;
    });

    afterAll(async () => {
      delete process.env.SIMULATOR_KEY;
      env.SIMULATOR_KEY = '';

      if (ioServer) {
        ioServer.cleanup();
        await new Promise((resolve) => ioServer.close(resolve));
      }
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
      }
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

    test('20 simulated patients burst join: strictly contiguous 1..20, zero duplicates, verified convergence', async () => {
      // 1. Seed organization, service, and counter
      const org = await Organization.create({ name: 'Burst Hospital', type: 'hospital' });
      const service = await Service.create({
        organizationId: org._id,
        name: 'General OPD',
        avgServiceTimeSec: 180,
        serviceSamples: 5,
        isActive: true,
      });
      await Counter.create({
        serviceId: service._id,
        name: 'Counter 1',
        status: 'active',
      });

      // 2. Run burst simulation with 20 patients
      const result = await runBurst({
        apiUrl: serverUrl,
        patientCount: 20,
        simulatorKey: SIM_KEY,
        patientCode: '123456',
        timeoutMs: 15000,
      });

      // 3. Verifications
      expect(result.patientCount).toBe(20);
      expect(result.tokenNumbers).toHaveLength(20);

      // Verify token numbers are strictly 1..20
      const expectedNumbers = Array.from({ length: 20 }, (_, i) => i + 1);
      expect(result.tokenNumbers).toEqual(expectedNumbers);

      // Zero duplicates
      expect(result.hasDuplicates).toBe(false);

      // Strictly contiguous
      expect(result.isContiguous).toBe(true);

      // Latencies recorded
      expect(result.latencies).toHaveLength(20);
      expect(result.percentiles.p50).toBeGreaterThan(0);
      expect(result.percentiles.p95).toBeGreaterThan(0);

      // Socket realtime convergence
      expect(result.convergence.isConverged).toBe(true);
      expect(result.convergence.convergedCount).toBe(20);
      expect(typeof result.convergence.convergenceTimeMs).toBe('number');
      expect(result.convergence.convergenceTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
