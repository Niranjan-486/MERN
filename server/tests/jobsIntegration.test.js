const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');
const request = require('supertest');
const Redis = require('ioredis');

const app = require('../src/app');
const { createRealtime } = require('../src/realtime');
const {
  Organization,
  Service,
  Counter,
  User,
  Token,
  TokenSequence,
  Notification,
} = require('../src/models');
const { signToken } = require('../src/middleware/auth');
const queueService = require('../src/services/queueService');
const { getQueueDate } = require('../src/utils/queueDate');
const env = require('../src/config/env');
const {
  startJobs,
  stopJobs,
  runSweeper,
  scheduleNearPlanner,
  runNearPlannerDirect,
  isRedisHealthy,
  isJobsRunning,
} = require('../src/jobs');
const { processNotificationJob } = require('../src/notifications');
const {
  registerChannel,
  resetChannels,
} = require('../src/notifications/channels');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

jest.setTimeout(45000);

let httpServer;
let ioServer;
let serverUrl;
const openSockets = [];
let redisClient;
let bullPrefix;

function createClientSocket(token) {
  const socket = Client(serverUrl, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  openSockets.push(socket);
  return socket;
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  env.NO_SHOW_GRACE_SECONDS = 1;

  await mongoose.connect(TEST_MONGO_URI);
  await Promise.all([
    Organization.syncIndexes(),
    Service.syncIndexes(),
    Counter.syncIndexes(),
    User.syncIndexes(),
    Token.syncIndexes(),
    TokenSequence.syncIndexes(),
    Notification.syncIndexes(),
  ]);

  bullPrefix = `test_bull_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  redisClient = new Redis(env.REDIS_URL);
  redisClient.on('error', () => {});

  httpServer = http.createServer(app);
  ioServer = createRealtime(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  serverUrl = `http://localhost:${port}`;

  // Start jobs subsystem with unique test prefix
  await startJobs({
    redisUrl: env.REDIS_URL,
    prefix: bullPrefix,
    sweeperInterval: 60000, // manual invocation in tests
  });
});

afterAll(async () => {
  for (const s of openSockets) {
    if (s.connected) s.disconnect();
  }
  openSockets.length = 0;

  await stopJobs();

  if (ioServer) {
    ioServer.cleanup();
    await new Promise((resolve) => ioServer.close(resolve));
  }
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch (_) {}
  }

  await mongoose.connection.close();
});

beforeEach(async () => {
  for (const s of openSockets) {
    if (s.connected) s.disconnect();
  }
  openSockets.length = 0;
  resetChannels();
  env.NOTIFY_CHANNELS = ['inapp', 'log'];
  env.NEAR_THRESHOLD = 3;

  await Promise.all([
    Organization.deleteMany({}),
    Service.deleteMany({}),
    Counter.deleteMany({}),
    User.deleteMany({}),
    Token.deleteMany({}),
    TokenSequence.deleteMany({}),
    Notification.deleteMany({}),
  ]);
});

describe('Phase 2: Timers and Reminders with BullMQ + Redis', () => {
  /**
   * Helper: creates an organization, service, counter, staff user, and N patient users
   */
  async function seedBasicQueue(patientCount = 1) {
    const org = await Organization.create({
      name: 'City General Hospital',
      type: 'hospital',
    });

    const service = await Service.create({
      organizationId: org._id,
      name: 'General OPD',
      avgServiceTimeSec: 300,
      serviceSamples: 0,
      isActive: true,
    });

    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Counter 1',
      status: 'active',
    });

    const staff = await User.create({
      phone: '9999900000',
      name: 'Staff Doctor',
      role: 'staff',
      organizationId: org._id,
    });

    const patients = [];
    for (let i = 1; i <= patientCount; i++) {
      const p = await User.create({
        phone: `999990000${i}`,
        name: `Patient ${i}`,
        role: 'patient',
      });
      patients.push(p);
    }

    const staffJwt = signToken(staff);
    const patientJwts = patients.map((p) => signToken(p));

    return { org, service, counter, staff, staffJwt, patients, patientJwts };
  }

  // -------------------------------------------------------------------------
  // Test a: markNoShow atomic state machine
  // -------------------------------------------------------------------------
  test('a. markNoShow: only matches a called token past grace; a second call is a no-op; a token already started is untouched; after no_show the counter can call the next token', async () => {
    const { service, counter, staff, patients } = await seedBasicQueue(2);

    // Patient 1 joins
    const token1 = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[0]._id,
    });

    // Staff calls token 1
    const calledToken1 = await queueService.callNext({
      counterId: counter._id,
      userOrganizationId: staff.organizationId,
    });
    expect(calledToken1._id.toString()).toBe(token1._id.toString());
    expect(calledToken1.status).toBe('called');

    // Simulate calledAt in the past (beyond 1s grace)
    await Token.updateOne(
      { _id: token1._id },
      { $set: { calledAt: new Date(Date.now() - 3000) } }
    );

    // First markNoShow call -> succeeds atomically
    const res1 = await queueService.markNoShow({
      tokenId: token1._id,
      graceMs: 1000,
      now: Date.now(),
    });
    expect(res1.changed).toBe(true);
    expect(res1.token.status).toBe('no_show');
    expect(res1.token.isActive).toBe(false);
    expect(res1.token.isHoldingCounter).toBe(false);

    // Counter's currentTokenId must be cleared
    const counterAfter = await Counter.findById(counter._id);
    expect(counterAfter.currentTokenId).toBeNull();

    // Second markNoShow call -> harmless no-op returning changed: false
    const res2 = await queueService.markNoShow({
      tokenId: token1._id,
      graceMs: 1000,
      now: Date.now(),
    });
    expect(res2.changed).toBe(false);

    // Patient 2 joins and is called
    const token2 = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[1]._id,
    });

    const calledToken2 = await queueService.callNext({
      counterId: counter._id,
      userOrganizationId: staff.organizationId,
    });
    expect(calledToken2._id.toString()).toBe(token2._id.toString());

    // Start serving token 2
    await queueService.startServing({
      tokenId: token2._id,
      counterId: counter._id,
    });

    // Attempt markNoShow on serving token -> untouched
    const res3 = await queueService.markNoShow({
      tokenId: token2._id,
      graceMs: 1000,
      now: Date.now(),
    });
    expect(res3.changed).toBe(false);
    const token2InDb = await Token.findById(token2._id);
    expect(token2InDb.status).toBe('serving');
  });

  // -------------------------------------------------------------------------
  // Test b: Near-planner
  // -------------------------------------------------------------------------
  test('b. Near-planner: 5 waiting tokens, threshold 3, 20 rapid planner runs -> exactly 4 Notifications (one per token), and a spy channel\'s send() runs once per notification', async () => {
    const { service, patients } = await seedBasicQueue(5);
    const queueDate = getQueueDate();

    // 5 waiting tokens created in call order
    const tokens = [];
    for (let i = 0; i < 5; i++) {
      const t = await Token.create({
        serviceId: service._id,
        userId: patients[i]._id,
        number: i + 1,
        queueDate,
        status: 'waiting',
        isActive: true,
        isHoldingCounter: false,
        priority: 0,
      });
      tokens.push(t);
    }

    const spySends = [];
    const spyChannel = {
      name: 'spy',
      async send(notification) {
        spySends.push(notification);
      },
    };
    registerChannel(spyChannel);
    env.NOTIFY_CHANNELS = ['spy'];
    env.NEAR_THRESHOLD = 3;

    // 20 rapid planner runs
    for (let i = 0; i < 20; i++) {
      scheduleNearPlanner(service._id.toString(), queueDate);
    }

    // Wait for single-flight + BullMQ worker to finish processing
    let notifications = [];
    for (let i = 0; i < 40; i++) {
      notifications = await Notification.find({
        serviceId: service._id,
        kind: 'near',
        status: 'sent',
      });
      if (notifications.length === 4 && spySends.length === 4) {
        break;
      }
      await sleep(100);
    }

    // Exactly 4 notifications (for tokens at indices 0, 1, 2, 3 where peopleAhead <= 3)
    expect(notifications.length).toBe(4);
    const notifiedTokenIds = new Set(notifications.map((n) => n.tokenId.toString()));
    expect(notifiedTokenIds.has(tokens[0]._id.toString())).toBe(true);
    expect(notifiedTokenIds.has(tokens[1]._id.toString())).toBe(true);
    expect(notifiedTokenIds.has(tokens[2]._id.toString())).toBe(true);
    expect(notifiedTokenIds.has(tokens[3]._id.toString())).toBe(true);
    expect(notifiedTokenIds.has(tokens[4]._id.toString())).toBe(false);

    // Spy channel send() executed exactly once per notification
    expect(spySends.length).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Test c: End to end automatic no-show
  // -------------------------------------------------------------------------
  test('c. End to end: call-next -> the patient\'s socket gets notification:new "called"; nobody starts -> within about 2.5 s the token is no_show, the patient\'s socket gets token:updated no_show and notification:new "no_show", and the counter can call the next token', async () => {
    const { service, counter, staff, patients, patientJwts } = await seedBasicQueue(2);

    const socket1 = createClientSocket(patientJwts[0]);
    await waitForConnect(socket1);

    const receivedNotifs = [];
    const receivedTokenUpdates = [];

    socket1.on('notification:new', (data) => {
      receivedNotifs.push(data);
    });

    socket1.on('token:updated', (data) => {
      receivedTokenUpdates.push(data);
    });

    // Patient 1 joins
    const t1 = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[0]._id,
    });

    // Patient 2 joins
    const t2 = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[1]._id,
    });

    // Staff calls next
    await queueService.callNext({
      counterId: counter._id,
      userOrganizationId: staff.organizationId,
    });

    // Wait for "called" notification:new
    let gotCalledNotif = false;
    for (let i = 0; i < 20; i++) {
      if (receivedNotifs.some((n) => n.kind === 'called' && String(n.tokenId) === String(t1._id))) {
        gotCalledNotif = true;
        break;
      }
      await sleep(100);
    }
    expect(gotCalledNotif).toBe(true);

    // Nobody starts. Timers worker delayed by NO_SHOW_GRACE_SECONDS (1s) executes markNoShow.
    // Within ~2.5s:
    let gotNoShowUpdate = false;
    let gotNoShowNotif = false;

    for (let i = 0; i < 35; i++) {
      if (
        receivedTokenUpdates.some(
          (u) => String(u.tokenId) === String(t1._id) && u.status === 'no_show'
        )
      ) {
        gotNoShowUpdate = true;
      }
      if (
        receivedNotifs.some(
          (n) => String(n.tokenId) === String(t1._id) && n.kind === 'no_show'
        )
      ) {
        gotNoShowNotif = true;
      }
      if (gotNoShowUpdate && gotNoShowNotif) break;
      await sleep(100);
    }

    expect(gotNoShowUpdate).toBe(true);
    expect(gotNoShowNotif).toBe(true);

    // After no_show, counter is free and can call Patient 2
    const calledToken2 = await queueService.callNext({
      counterId: counter._id,
      userOrganizationId: staff.organizationId,
    });
    expect(calledToken2._id.toString()).toBe(t2._id.toString());
  });

  // -------------------------------------------------------------------------
  // Test d: Start before grace
  // -------------------------------------------------------------------------
  test('d. Start before grace: the token is still serving after the grace period has passed', async () => {
    const { service, counter, staff, patients } = await seedBasicQueue(1);

    const token = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[0]._id,
    });

    await queueService.callNext({
      counterId: counter._id,
      userOrganizationId: staff.organizationId,
    });

    // Immediately start serving before grace expires
    await queueService.startServing({
      tokenId: token._id,
      counterId: counter._id,
    });

    // Wait 1.8s (beyond 1s grace period)
    await sleep(1800);

    const tokenInDb = await Token.findById(token._id);
    expect(tokenInDb.status).toBe('serving');
    expect(tokenInDb.isActive).toBe(true);
    expect(tokenInDb.isHoldingCounter).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test e: Race between start-serving and markNoShow (20 repetitions)
  // -------------------------------------------------------------------------
  test('e. Race: start-serving at the same moment as the no-show handler, 20 repetitions: the final state is exactly one of serving or no_show, the counter is consistent, and a no_show Notification exists only when the result is no_show', async () => {
    for (let rep = 0; rep < 20; rep++) {
      await Promise.all([
        Organization.deleteMany({}),
        Service.deleteMany({}),
        Counter.deleteMany({}),
        User.deleteMany({}),
        Token.deleteMany({}),
        TokenSequence.deleteMany({}),
        Notification.deleteMany({}),
      ]);

      const { service, counter, staff, patients } = await seedBasicQueue(1);

      const token = await queueService.joinQueue({
        serviceId: service._id,
        userId: patients[0]._id,
      });

      await queueService.callNext({
        counterId: counter._id,
        userOrganizationId: staff.organizationId,
      });

      // Age token so it's eligible for markNoShow
      await Token.updateOne(
        { _id: token._id },
        { $set: { calledAt: new Date(Date.now() - 2500) } }
      );

      // Race startServing against markNoShow simultaneously
      const [startRes, noShowRes] = await Promise.allSettled([
        queueService.startServing({ tokenId: token._id, counterId: counter._id }),
        queueService.markNoShow({ tokenId: token._id, graceMs: 1000, now: Date.now() }),
      ]);

      const finalToken = await Token.findById(token._id);
      expect(['serving', 'no_show']).toContain(finalToken.status);

      const finalCounter = await Counter.findById(counter._id);
      if (finalToken.status === 'serving') {
        expect(finalCounter.currentTokenId.toString()).toBe(token._id.toString());
      } else {
        expect(finalCounter.currentTokenId).toBeNull();
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test f: Retry on flaky notification channel
  // -------------------------------------------------------------------------
  test('f. Retry: a channel that fails twice and then succeeds -> one Notification, status sent, attempts 3, no channel delivered twice', async () => {
    const { service, counter, patients } = await seedBasicQueue(1);

    const token = await Token.create({
      serviceId: service._id,
      userId: patients[0]._id,
      number: 1,
      queueDate: getQueueDate(),
      status: 'waiting',
      isActive: true,
      isHoldingCounter: false,
      priority: 0,
    });

    const inappDeliveries = [];
    const flakeDeliveries = [];
    let failCount = 0;

    const spyInapp = {
      name: 'inapp',
      async send(notification) {
        inappDeliveries.push(notification._id.toString());
      },
    };

    const flakyChannel = {
      name: 'flaky',
      async send(notification) {
        failCount += 1;
        if (failCount < 3) {
          throw new Error(`Flaky channel simulated error attempt ${failCount}`);
        }
        flakeDeliveries.push(notification._id.toString());
      },
    };

    registerChannel(spyInapp);
    registerChannel(flakyChannel);
    env.NOTIFY_CHANNELS = ['inapp', 'flaky'];

    // Attempt 1: inapp succeeds, flaky throws
    await expect(
      processNotificationJob({ tokenId: token._id, kind: 'near' })
    ).rejects.toThrow('Flaky channel simulated error attempt 1');

    // Attempt 2: inapp skipped (already in deliveredChannels), flaky throws
    await expect(
      processNotificationJob({ tokenId: token._id, kind: 'near' })
    ).rejects.toThrow('Flaky channel simulated error attempt 2');

    // Attempt 3: inapp skipped, flaky succeeds
    await processNotificationJob({ tokenId: token._id, kind: 'near' });

    const notifs = await Notification.find({ tokenId: token._id, kind: 'near' });
    expect(notifs.length).toBe(1);

    const finalNotif = notifs[0];
    expect(finalNotif.status).toBe('sent');
    expect(finalNotif.attempts).toBe(3);
    expect(finalNotif.deliveredChannels).toContain('inapp');
    expect(finalNotif.deliveredChannels).toContain('flaky');

    // Neither channel was delivered more than once!
    expect(inappDeliveries.length).toBe(1);
    expect(flakeDeliveries.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test g: Redis wipe and sweeper healing
  // -------------------------------------------------------------------------
  test('g. Redis wipe: with an overdue called token and waiting tokens within the threshold, flush the test Redis and run the sweeper once -> the token becomes no_show and the near notifications get created', async () => {
    const { service, counter, patients } = await seedBasicQueue(3);
    const queueDate = getQueueDate();

    // Overdue called token holding the counter
    const tokenCalled = await Token.create({
      serviceId: service._id,
      userId: patients[0]._id,
      counterId: counter._id,
      number: 1,
      queueDate,
      status: 'called',
      calledAt: new Date(Date.now() - 5000),
      isActive: true,
      isHoldingCounter: true,
      priority: 0,
    });
    await Counter.updateOne({ _id: counter._id }, { currentTokenId: tokenCalled._id });

    // Waiting tokens within threshold
    const tokenWait1 = await Token.create({
      serviceId: service._id,
      userId: patients[1]._id,
      number: 2,
      queueDate,
      status: 'waiting',
      isActive: true,
      isHoldingCounter: false,
      priority: 0,
    });
    const tokenWait2 = await Token.create({
      serviceId: service._id,
      userId: patients[2]._id,
      number: 3,
      queueDate,
      status: 'waiting',
      isActive: true,
      isHoldingCounter: false,
      priority: 0,
    });

    // Wipe test Redis completely (simulates Redis data loss / wipe)
    await redisClient.flushdb();

    // Run sweeper once
    await runSweeper();

    // Verify overdue token healed to no_show and counter is freed
    const healedToken = await Token.findById(tokenCalled._id);
    expect(healedToken.status).toBe('no_show');
    expect(healedToken.isActive).toBe(false);
    const counterAfter = await Counter.findById(counter._id);
    expect(counterAfter.currentTokenId).toBeNull();

    // Verify near notifications created for waiting tokens
    let notifs = [];
    for (let i = 0; i < 40; i++) {
      notifs = await Notification.find({
        tokenId: { $in: [tokenWait1._id, tokenWait2._id] },
        kind: 'near',
        status: 'sent',
      });
      if (notifs.length === 2) break;
      await sleep(100);
    }

    expect(notifs.length).toBe(2);
    const notifiedIds = notifs.map((n) => n.tokenId.toString());
    expect(notifiedIds).toContain(tokenWait1._id.toString());
    expect(notifiedIds).toContain(tokenWait2._id.toString());
  });

  // -------------------------------------------------------------------------
  // Test h: Redis unavailable at startup + background retry
  // -------------------------------------------------------------------------
  test('h. Redis unavailable at startup: the app starts, queue operations work, /ready reports redis down, no unhandled errors. A unit test with an injected connect function that fails twice and then succeeds proves the background retry starts the job system by itself', async () => {
    // Stop currently running jobs
    await stopJobs();

    let connectAttempts = 0;
    const flakyConnect = async () => {
      connectAttempts += 1;
      if (connectAttempts < 3) {
        return false; // Fails twice
      }
      return true; // Succeeds on attempt 3
    };

    const started = await startJobs({
      redisUrl: env.REDIS_URL,
      connectFn: flakyConnect,
      retrySchedule: [50, 50],
      prefix: `test_h_${Date.now()}`,
    });

    // Should return false initially because Redis was unreachable
    expect(started).toBe(false);
    expect(isRedisHealthy()).toBe(false);
    expect(isJobsRunning()).toBe(false);

    // Queue operations continue to work without errors
    const { service, patients } = await seedBasicQueue(1);
    const t = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[0]._id,
    });
    expect(t).toBeDefined();

    // GET /ready reports redis down
    const readyRes = await request(app).get('/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.mongo).toBe('connected');
    expect(readyRes.body.redis).toBe('down');
    expect(readyRes.body.jobs).toBe('stopped');

    // Wait for background retry (2 x 50ms = 100ms)
    for (let i = 0; i < 20; i++) {
      if (isJobsRunning() && isRedisHealthy()) break;
      await sleep(50);
    }

    expect(connectAttempts).toBeGreaterThanOrEqual(3);
    expect(isRedisHealthy()).toBe(true);
    expect(isJobsRunning()).toBe(true);

    const readyAfter = await request(app).get('/ready');
    expect(readyAfter.body.redis).toBe('up');
    expect(readyAfter.body.jobs).toBe('running');

    // Clean up test h's jobs and restore test runner prefix
    await stopJobs();
    await startJobs({
      redisUrl: env.REDIS_URL,
      prefix: bullPrefix,
      sweeperInterval: 60000,
    });
  });

  // -------------------------------------------------------------------------
  // Test i: GET /api/me/notifications endpoint
  // -------------------------------------------------------------------------
  test('i. GET /api/me/notifications returns only the caller\'s notifications for today, newest first', async () => {
    const { service, patients, patientJwts } = await seedBasicQueue(2);
    const today = getQueueDate();

    const t1 = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[0]._id,
    });
    const t2 = await queueService.joinQueue({
      serviceId: service._id,
      userId: patients[1]._id,
    });

    // Patient 1 - Notification 1 (older)
    const n1 = await Notification.create({
      userId: patients[0]._id,
      tokenId: t1._id,
      serviceId: service._id,
      queueDate: today,
      kind: 'near',
      title: 'Near update',
      body: 'Your turn is near',
      status: 'sent',
      createdAt: new Date(Date.now() - 5000),
    });

    // Patient 1 - Notification 2 (newer)
    const n2 = await Notification.create({
      userId: patients[0]._id,
      tokenId: t1._id,
      serviceId: service._id,
      queueDate: today,
      kind: 'called',
      title: 'Called update',
      body: 'Please proceed to desk',
      status: 'sent',
      createdAt: new Date(Date.now() - 1000),
    });

    const tOld = await Token.create({
      serviceId: service._id,
      userId: patients[0]._id,
      number: 999,
      queueDate: '2020-01-01',
      status: 'completed',
      isActive: false,
    });

    // Patient 1 - Notification from yesterday (should be excluded)
    await Notification.create({
      userId: patients[0]._id,
      tokenId: tOld._id,
      serviceId: service._id,
      queueDate: '2020-01-01',
      kind: 'near',
      title: 'Old update',
      body: 'Old notification',
      status: 'sent',
      createdAt: new Date(Date.now() - 86400000),
    });

    // Patient 2 - Notification (should be excluded from Patient 1 response)
    await Notification.create({
      userId: patients[1]._id,
      tokenId: t2._id,
      serviceId: service._id,
      queueDate: today,
      kind: 'called',
      title: 'Other patient',
      body: 'Different user',
      status: 'sent',
    });

    // Request as Patient 1
    const res = await request(app)
      .get('/api/me/notifications')
      .set('Authorization', `Bearer ${patientJwts[0]}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);

    // Newest first
    expect(res.body[0].id).toBe(n2._id.toString());
    expect(res.body[0].kind).toBe('called');
    expect(res.body[1].id).toBe(n1._id.toString());
    expect(res.body[1].kind).toBe('near');
  });
});
