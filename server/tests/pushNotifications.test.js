const http = require('http');
const mongoose = require('mongoose');
const request = require('supertest');

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
  PushSubscription,
} = require('../src/models');
const { signToken } = require('../src/middleware/auth');
const queueService = require('../src/services/queueService');
const pushChannel = require('../src/notifications/channels/push');
const { resetChannels } = require('../src/notifications/channels');
const env = require('../src/config/env');
const { startJobs, stopJobs } = require('../src/jobs');
const { processNotificationJob } = require('../src/notifications');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

const VALID_P256DH =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DQA';
const VALID_AUTH = 'tBHItJI5svbpez7KI4CCXg';
const VALID_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/fake-sub-endpoint-12345';

jest.setTimeout(30000);

describe('Web Push (VAPID) & Notifications Integration', () => {
  let server;
  let user1;
  let user2;
  let user1Token;
  let user2Token;
  let bullPrefix;

  beforeAll(async () => {
    await mongoose.connect(TEST_MONGO_URI);
    await Promise.all([
      Organization.syncIndexes(),
      Service.syncIndexes(),
      Counter.syncIndexes(),
      User.syncIndexes(),
      Token.syncIndexes(),
      TokenSequence.syncIndexes(),
      Notification.syncIndexes(),
      PushSubscription.syncIndexes(),
    ]);

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
  });

  afterAll(async () => {
    pushChannel.resetSender();
    resetChannels();
    await stopJobs();
    if (server) {
      await new Promise((r) => server.close(r));
    }
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    pushChannel.resetSender();
    resetChannels();
    env.NOTIFY_CHANNELS = ['inapp', 'log'];
    env.VAPID_PUBLIC_KEY =
      'BAjCUTt4CavApgZRym7GoHdcdWPzBbBWtObVO6pDdFR6CRaDGiFuLO2uZ1vDIXy_ktQaa8h1IK0TLITLoCqNZSE';
    env.VAPID_PRIVATE_KEY = 'VXNWvj3lPbkVWm7x5cLuCVMG2qX5QkSLs9IKR4q19vo';
    env.VAPID_SUBJECT = 'mailto:admin@smartqueue.local';

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

    user1 = await User.create({
      phone: '9999900011',
      name: 'User One',
      role: 'patient',
    });
    user2 = await User.create({
      phone: '9999900012',
      name: 'User Two',
      role: 'patient',
    });
    user1Token = signToken(user1);
    user2Token = signToken(user2);
  });

  // ---------------------------------------------------------------------------
  // a. Subscription API
  // ---------------------------------------------------------------------------
  describe('a. Subscription API', () => {
    test('authentication required', async () => {
      const res = await request(app).get('/api/push/public-key');
      expect(res.status).toBe(401);

      const postRes = await request(app)
        .post('/api/push/subscriptions')
        .send({ endpoint: VALID_ENDPOINT, keys: { p256dh: VALID_P256DH, auth: VALID_AUTH } });
      expect(postRes.status).toBe(401);
    });

    test('invalid payloads rejected (http endpoint, missing keys, oversized)', async () => {
      // 1. HTTP instead of HTTPS
      const resHttp = await request(app)
        .post('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          endpoint: 'http://insecure.endpoint.com/send/123',
          keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        });
      expect(resHttp.status).toBe(400);
      expect(resHttp.body.error.code).toBe('VALIDATION_ERROR');

      // 2. Missing keys
      const resNoKeys = await request(app)
        .post('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          endpoint: VALID_ENDPOINT,
        });
      expect(resNoKeys.status).toBe(400);

      // 3. Invalid / malformed keys
      const resBadKeys = await request(app)
        .post('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          endpoint: VALID_ENDPOINT,
          keys: { p256dh: 'not-base64!', auth: 'short' },
        });
      expect(resBadKeys.status).toBe(400);

      // 4. Oversized endpoint (> 2048 chars)
      const resOversized = await request(app)
        .post('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          endpoint: 'https://example.com/' + 'a'.repeat(2050),
          keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        });
      expect(resOversized.status).toBe(400);
    });

    test('the same endpoint posted twice -> one document; second user takes ownership', async () => {
      // User 1 posts subscription
      const res1 = await request(app)
        .post('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          endpoint: VALID_ENDPOINT,
          keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        });
      expect(res1.status).toBe(200);

      // User 1 posts same endpoint again
      const res2 = await request(app)
        .post('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          endpoint: VALID_ENDPOINT,
          keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        });
      expect(res2.status).toBe(200);

      const count1 = await PushSubscription.countDocuments({ endpoint: VALID_ENDPOINT });
      expect(count1).toBe(1);

      // User 2 posts the SAME endpoint (e.g. shared phone logs in as User 2)
      const res3 = await request(app)
        .post('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          endpoint: VALID_ENDPOINT,
          keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        });
      expect(res3.status).toBe(200);

      // Exactly one document exists, and its userId is now User 2
      const updatedSub = await PushSubscription.findOne({ endpoint: VALID_ENDPOINT });
      expect(updatedSub.userId.toString()).toBe(user2._id.toString());
    });

    test('DELETE affects only caller subscription and is idempotent', async () => {
      // User 2 owns VALID_ENDPOINT
      await PushSubscription.create({
        userId: user2._id,
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });

      // User 1 attempts to delete User 2's subscription
      const resUnauthorizedDelete = await request(app)
        .delete('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ endpoint: VALID_ENDPOINT });
      expect(resUnauthorizedDelete.status).toBe(200);

      // Verify User 2's subscription still exists
      const subStillThere = await PushSubscription.findOne({ endpoint: VALID_ENDPOINT });
      expect(subStillThere).not.toBeNull();

      // User 2 deletes own subscription
      const resUser2Delete = await request(app)
        .delete('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ endpoint: VALID_ENDPOINT });
      expect(resUser2Delete.status).toBe(200);
      const subAfter = await PushSubscription.findOne({ endpoint: VALID_ENDPOINT });
      expect(subAfter).toBeNull();

      // Idempotent: deleting again returns 200
      const resIdempotent = await request(app)
        .delete('/api/push/subscriptions')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ endpoint: VALID_ENDPOINT });
      expect(resIdempotent.status).toBe(200);
    });

    test('the 6th subscription removes the oldest beyond 5', async () => {
      for (let i = 1; i <= 6; i++) {
        const res = await request(app)
          .post('/api/push/subscriptions')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({
            endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}`,
            keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
          });
        expect(res.status).toBe(200);
      }

      const subs = await PushSubscription.find({ userId: user1._id }).sort({ updatedAt: -1 });
      expect(subs.length).toBe(5);
      // The oldest device-1 must have been pruned
      const endpoints = subs.map((s) => s.endpoint);
      expect(endpoints).not.toContain('https://fcm.googleapis.com/fcm/send/device-1');
      expect(endpoints).toContain('https://fcm.googleapis.com/fcm/send/device-6');
    });

    test('public-key returns 503 PUSH_DISABLED when the push channel is off', async () => {
      // Default NOTIFY_CHANNELS is ['inapp', 'log'], push is not included
      env.NOTIFY_CHANNELS = ['inapp', 'log'];
      const resDisabled = await request(app)
        .get('/api/push/public-key')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(resDisabled.status).toBe(503);
      expect(resDisabled.body.error.code).toBe('PUSH_DISABLED');

      // Enable push
      env.NOTIFY_CHANNELS = ['inapp', 'push', 'log'];
      const resEnabled = await request(app)
        .get('/api/push/public-key')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(resEnabled.status).toBe(200);
      expect(resEnabled.body.publicKey).toBe(env.VAPID_PUBLIC_KEY);
    });
  });

  // ---------------------------------------------------------------------------
  // b. push channel
  // ---------------------------------------------------------------------------
  describe('b. push channel', () => {
    test('no subscriptions -> resolves cleanly', async () => {
      const notification = {
        userId: user1._id,
        tokenId: new mongoose.Types.ObjectId(),
        kind: 'called',
        title: 'Your turn',
        body: 'Please proceed to desk',
      };
      await expect(pushChannel.send(notification)).resolves.toBeUndefined();
    });

    test('success: payload has title/body/kind/tag/url, NO name or phone; TTL/urgency/topic right per kind', async () => {
      const sub = await PushSubscription.create({
        userId: user1._id,
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });

      const sentCalls = [];
      pushChannel.setSender(async (subArg, payloadArg, optionsArg) => {
        sentCalls.push({ sub: subArg, payload: JSON.parse(payloadArg), options: optionsArg });
        return { statusCode: 201 };
      });

      const tokenId = new mongoose.Types.ObjectId();

      // 1. Kind: "called"
      env.NO_SHOW_GRACE_SECONDS = 120;
      await pushChannel.send({
        userId: user1._id,
        tokenId,
        kind: 'called',
        title: 'Token #1 called',
        body: 'Please proceed to Counter 1',
      });

      expect(sentCalls.length).toBe(1);
      const call1 = sentCalls[0];
      expect(call1.payload.title).toBe('Token #1 called');
      expect(call1.payload.body).toBe('Please proceed to Counter 1');
      expect(call1.payload.kind).toBe('called');
      expect(call1.payload.tag).toBe(`token-${tokenId}`);
      expect(call1.payload.url).toBe('/');
      expect(call1.payload.requireInteraction).toBe(true);
      // Privacy: no name or phone in payload
      expect(JSON.stringify(call1.payload)).not.toContain('User One');
      expect(JSON.stringify(call1.payload)).not.toContain('9999900011');
      expect(call1.options.TTL).toBe(120);
      expect(call1.options.urgency).toBe('high');
      expect(call1.options.topic).toBe(`t${tokenId}`);

      // 2. Kind: "near"
      sentCalls.length = 0;
      await pushChannel.send({
        userId: user1._id,
        tokenId,
        kind: 'near',
        title: 'Turn is near',
        body: 'You are next in line',
      });
      expect(sentCalls[0].options.TTL).toBe(600);
      expect(sentCalls[0].options.urgency).toBe('high');
      expect(sentCalls[0].payload.requireInteraction).toBe(false);

      // 3. Kind: "no_show"
      sentCalls.length = 0;
      await pushChannel.send({
        userId: user1._id,
        tokenId,
        kind: 'no_show',
        title: 'Missed turn',
        body: 'Marked as no show',
      });
      expect(sentCalls[0].options.TTL).toBe(3600);
      expect(sentCalls[0].options.urgency).toBe('normal');
    });

    test('404 and 410: subscription is deleted and call still resolves', async () => {
      const sub = await PushSubscription.create({
        userId: user1._id,
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });

      pushChannel.setSender(async () => {
        const err = new Error('Subscription expired');
        err.statusCode = 410;
        throw err;
      });

      await expect(
        pushChannel.send({
          userId: user1._id,
          tokenId: new mongoose.Types.ObjectId(),
          kind: 'called',
          title: 'Your turn',
          body: 'Go to desk',
        })
      ).resolves.toBeUndefined();

      const subInDb = await PushSubscription.findById(sub._id);
      expect(subInDb).toBeNull();
    });

    test('every attempted send failing with 500/429/network error -> throws', async () => {
      await PushSubscription.create({
        userId: user1._id,
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });

      pushChannel.setSender(async () => {
        const err = new Error('Push service unavailable');
        err.statusCode = 503;
        throw err;
      });

      await expect(
        pushChannel.send({
          userId: user1._id,
          tokenId: new mongoose.Types.ObjectId(),
          kind: 'called',
          title: 'Your turn',
          body: 'Go to desk',
        })
      ).rejects.toThrow('Push delivery failed for all 1 device(s)');
    });

    test('one success plus one 500 -> resolves and failing subscription failureCount increments; 5th failure deletes', async () => {
      const subGood = await PushSubscription.create({
        userId: user1._id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/good',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        failureCount: 0,
      });
      const subFlaky = await PushSubscription.create({
        userId: user1._id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/flaky',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        failureCount: 3,
      });

      pushChannel.setSender(async (sub) => {
        if (sub.endpoint.includes('good')) {
          return { statusCode: 201 };
        }
        const err = new Error('Server error');
        err.statusCode = 500;
        throw err;
      });

      // Pass 1: good succeeds, flaky fails (failureCount 3 -> 4). Call must resolve!
      await expect(
        pushChannel.send({
          userId: user1._id,
          tokenId: new mongoose.Types.ObjectId(),
          kind: 'near',
          title: 'Near',
          body: 'Almost there',
        })
      ).resolves.toBeUndefined();

      const flakyAfter1 = await PushSubscription.findById(subFlaky._id);
      expect(flakyAfter1.failureCount).toBe(4);

      // Pass 2: good succeeds, flaky fails (failureCount 4 + 1 = 5 -> deleted!)
      await expect(
        pushChannel.send({
          userId: user1._id,
          tokenId: new mongoose.Types.ObjectId(),
          kind: 'near',
          title: 'Near',
          body: 'Almost there',
        })
      ).resolves.toBeUndefined();

      const flakyAfter2 = await PushSubscription.findById(subFlaky._id);
      expect(flakyAfter2).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // c. Pipeline (real Redis and BullMQ, fake sender)
  // ---------------------------------------------------------------------------
  describe('c. Pipeline (real Redis & BullMQ)', () => {
    beforeAll(async () => {
      bullPrefix = `test_push_pipe_${Date.now()}`;
      await startJobs({
        redisUrl: env.REDIS_URL,
        prefix: bullPrefix,
      });
    });

    afterAll(async () => {
      await stopJobs();
    });

    test('user with 2 subscriptions: call-next -> each subscription receives exactly one "called" push; Notification.deliveredChannels contains inapp, push, log once', async () => {
      const org = await Organization.create({ name: 'Push Clinic', type: 'hospital' });
      const service = await Service.create({
        organizationId: org._id,
        name: 'Urgent Care',
        avgServiceTimeSec: 180,
        isActive: true,
      });
      const counter = await Counter.create({
        serviceId: service._id,
        name: 'Desk 1',
        status: 'active',
      });
      const staff = await User.create({
        phone: '9999900099',
        name: 'Staff Doctor',
        role: 'staff',
        organizationId: org._id,
      });

      // User 1 has 2 subscriptions
      await PushSubscription.create({
        userId: user1._id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/device-a',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });
      await PushSubscription.create({
        userId: user1._id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/device-b',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });

      const pushSends = [];
      let callsOnAttempt1 = 0;
      pushChannel.setSender(async (sub, payload, options) => {
        if (callsOnAttempt1 < 2) {
          callsOnAttempt1 += 1;
          const err = new Error('Transient push network error');
          err.statusCode = 503;
          throw err;
        }
        pushSends.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
        return { statusCode: 201 };
      });

      env.NOTIFY_CHANNELS = ['inapp', 'push', 'log'];

      // User 1 joins
      const token = await queueService.joinQueue({
        serviceId: service._id,
        userId: user1._id,
      });

      // Staff calls next
      await queueService.callNext({
        counterId: counter._id,
        userOrganizationId: staff.organizationId,
      });

      // Wait for BullMQ retry and notification delivery
      let notif;
      for (let i = 0; i < 50; i++) {
        notif = await Notification.findOne({ tokenId: token._id, kind: 'called' });
        if (notif && notif.status === 'sent' && pushSends.length >= 2) {
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      expect(notif).toBeDefined();
      expect(notif.status).toBe('sent');
      expect(notif.deliveredChannels).toContain('inapp');
      expect(notif.deliveredChannels).toContain('push');
      expect(notif.deliveredChannels).toContain('log');
      // No duplicate channels recorded
      expect(notif.deliveredChannels.filter((c) => c === 'push').length).toBe(1);

      // Each of the 2 subscriptions received exactly one called push
      expect(pushSends.length).toBe(2);
      const notifiedEndpoints = pushSends.map((s) => s.endpoint);
      expect(notifiedEndpoints).toContain('https://fcm.googleapis.com/fcm/send/device-a');
      expect(notifiedEndpoints).toContain('https://fcm.googleapis.com/fcm/send/device-b');
    });
  });

  // ---------------------------------------------------------------------------
  // d. Config: fail fast when push is in NOTIFY_CHANNELS
  // ---------------------------------------------------------------------------
  describe('d. Config validation', () => {
    test('push in NOTIFY_CHANNELS with missing or invalid VAPID values fails fast with a clear message', () => {
      // 1. Missing public key
      expect(() => {
        env.validateVapidConfig({
          publicKey: '',
          privateKey: 'valid_private_key_string_of_at_least_40_chars_long!!',
          subject: 'mailto:admin@example.com',
        });
      }).toThrow(/VAPID_PUBLIC_KEY must be a valid base64url string/);

      // 2. Missing private key
      expect(() => {
        env.validateVapidConfig({
          publicKey: 'a'.repeat(87),
          privateKey: '',
          subject: 'mailto:admin@example.com',
        });
      }).toThrow(/VAPID_PRIVATE_KEY must be a valid base64url string/);

      // 3. Invalid subject (not mailto: or https:)
      expect(() => {
        env.validateVapidConfig({
          publicKey: 'a'.repeat(87),
          privateKey: 'b'.repeat(43),
          subject: 'ftp://invalid-url.com',
        });
      }).toThrow(/VAPID_SUBJECT must be a valid mailto: or https: URL/);

      // 4. Valid keys pass
      expect(() => {
        env.validateVapidConfig({
          publicKey: 'a'.repeat(87),
          privateKey: 'b'.repeat(43),
          subject: 'mailto:admin@example.com',
        });
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // e. POST /api/push/test
  // ---------------------------------------------------------------------------
  describe('e. POST /api/push/test endpoint', () => {
    test('sends only to caller subscriptions; second call within 10s gets 429', async () => {
      await PushSubscription.create({
        userId: user1._id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/user1-phone',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });
      await PushSubscription.create({
        userId: user2._id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/user2-phone',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });

      const testSends = [];
      pushChannel.setSender(async (sub, payload) => {
        testSends.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
        return { statusCode: 201 };
      });

      // Call 1 from User 1
      const res1 = await request(app)
        .post('/api/push/test')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res1.status).toBe(200);
      expect(res1.body).toEqual({ sent: 1, removed: 0, failed: 0 });
      expect(testSends.length).toBe(1);
      expect(testSends[0].endpoint).toBe('https://fcm.googleapis.com/fcm/send/user1-phone');
      expect(testSends[0].payload.kind).toBe('test');

      // Call 2 from User 1 within 10s -> 429
      const res2 = await request(app)
        .post('/api/push/test')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res2.status).toBe(429);
      expect(res2.body.error.code).toBe('RATE_LIMITED');
    });
  });
});
