const mongoose = require('mongoose');
const { Organization, Service, Counter, User, Token, TokenSequence } = require('../src/models');
const queueService = require('../src/services/queueService');

const TEST_MONGO_URI = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

// Increase Jest timeout for concurrency tests
jest.setTimeout(45000);

beforeAll(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Ensure all collections and indexes exist
  await Promise.all([
    Organization.syncIndexes(),
    Service.syncIndexes(),
    Counter.syncIndexes(),
    User.syncIndexes(),
    Token.syncIndexes(),
    TokenSequence.syncIndexes(),
  ]);
});

afterAll(async () => {
  await mongoose.connection.close();
});

beforeEach(async () => {
  // Clear collections between tests without dropping database/indexes
  await Promise.all([
    Organization.deleteMany({}),
    Service.deleteMany({}),
    Counter.deleteMany({}),
    User.deleteMany({}),
    Token.deleteMany({}),
    TokenSequence.deleteMany({}),
  ]);
});

describe('Queue Engine Concurrency & Correctness Integration Tests', () => {
  // a. 100 different patients join one service in parallel
  test('a. 100 different patients join in parallel: all succeed, numbers are 1..100 with no gaps or duplicates', async () => {
    const org = await Organization.create({ name: 'Hospital A', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });

    const userDocs = Array.from({ length: 100 }, (_, i) => ({
      phone: `+919800000${String(i).padStart(3, '0')}`,
      name: `User ${i + 1}`,
      role: 'patient',
    }));
    const users = await User.insertMany(userDocs);

    // Join all 100 in parallel
    const joinPromises = users.map((u) =>
      queueService.joinQueue({ serviceId: service._id, userId: u._id, priority: 0 })
    );
    const results = await Promise.all(joinPromises);

    expect(results).toHaveLength(100);

    const numbers = results.map((t) => t.number).sort((a, b) => a - b);
    const expectedNumbers = Array.from({ length: 100 }, (_, i) => i + 1);

    expect(numbers).toEqual(expectedNumbers);
    expect(new Set(numbers).size).toBe(100);
  });

  // b. The same user joins the same service 10 times in parallel
  test('b. Same user joins 10 times in parallel: exactly 1 succeeds, 9 fail with ALREADY_IN_QUEUE', async () => {
    const org = await Organization.create({ name: 'Hospital B', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });
    const user = await User.create({ phone: '+919811111111', name: 'Concurrent User', role: 'patient' });

    const joinPromises = Array.from({ length: 10 }).map(() =>
      queueService.joinQueue({ serviceId: service._id, userId: user._id })
    );

    const settled = await Promise.allSettled(joinPromises);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    for (const rej of rejected) {
      expect(rej.reason.code).toBe('ALREADY_IN_QUEUE');
      expect(rej.reason.statusCode).toBe(409);
      expect(rej.reason.details.token).toBeDefined();
      expect(String(rej.reason.details.token._id)).toBe(String(fulfilled[0].value._id));
    }

    const activeTokens = await Token.find({
      serviceId: service._id,
      userId: user._id,
      isActive: true,
    });
    expect(activeTokens).toHaveLength(1);
  });

  // c. Counters call next in parallel: (10 waiting, 10 counters) and (3 waiting, 6 counters)
  test('c. Counters call next in parallel: no token given to two counters, extra calls get QUEUE_EMPTY', async () => {
    const org = await Organization.create({ name: 'Hospital C', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });

    // Run 1: 10 waiting tokens, 10 counters
    {
      const users = await User.insertMany(
        Array.from({ length: 10 }, (_, i) => ({
          phone: `+919822200${i}`,
          name: `User ${i}`,
          role: 'patient',
        }))
      );
      for (const u of users) {
        await queueService.joinQueue({ serviceId: service._id, userId: u._id });
      }

      const counters = await Counter.insertMany(
        Array.from({ length: 10 }, (_, i) => ({
          serviceId: service._id,
          name: `Counter ${i}`,
          status: 'active',
        }))
      );

      const results = await Promise.all(
        counters.map((c) => queueService.callNext({ counterId: c._id }))
      );

      const assignedTokenIds = results.map((t) => String(t._id));
      expect(new Set(assignedTokenIds).size).toBe(10);
    }

    // Clean tokens and counters for Run 2
    await Token.deleteMany({});
    await Counter.deleteMany({});
    await TokenSequence.deleteMany({});

    // Run 2: 3 waiting tokens, 6 counters
    {
      const users = await User.insertMany(
        Array.from({ length: 3 }, (_, i) => ({
          phone: `+919833300${i}`,
          name: `User ${i}`,
          role: 'patient',
        }))
      );
      for (const u of users) {
        await queueService.joinQueue({ serviceId: service._id, userId: u._id });
      }

      const counters = await Counter.insertMany(
        Array.from({ length: 6 }, (_, i) => ({
          serviceId: service._id,
          name: `Counter ${i}`,
          status: 'active',
        }))
      );

      const settled = await Promise.allSettled(
        counters.map((c) => queueService.callNext({ counterId: c._id }))
      );

      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');

      expect(fulfilled).toHaveLength(3);
      expect(rejected).toHaveLength(3);

      const assignedTokenIds = fulfilled.map((s) => String(s.value._id));
      expect(new Set(assignedTokenIds).size).toBe(3);

      for (const rej of rejected) {
        expect(rej.reason.code).toBe('QUEUE_EMPTY');
        expect(rej.reason.statusCode).toBe(409);
      }
    }
  });

  // d. The same counter calls next twice in parallel
  test('d. Same counter calls next twice in parallel: exactly 1 succeeds, other gets COUNTER_BUSY', async () => {
    const org = await Organization.create({ name: 'Hospital D', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });
    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Desk 1',
      status: 'active',
    });

    const users = await User.insertMany([
      { phone: '+9198444001', name: 'User 1', role: 'patient' },
      { phone: '+9198444002', name: 'User 2', role: 'patient' },
    ]);
    for (const u of users) {
      await queueService.joinQueue({ serviceId: service._id, userId: u._id });
    }

    const settled = await Promise.allSettled([
      queueService.callNext({ counterId: counter._id }),
      queueService.callNext({ counterId: counter._id }),
    ]);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('COUNTER_BUSY');
    expect(rejected[0].reason.statusCode).toBe(409);
  });

  // e. Ordering: join normal, senior (1), emergency (2), normal
  test('e. Ordering: call-next returns emergency, senior, then normal tokens by number', async () => {
    const org = await Organization.create({ name: 'Hospital E', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });

    const u1 = await User.create({ phone: '+9198555001', name: 'Norm1', role: 'patient' });
    const u2 = await User.create({ phone: '+9198555002', name: 'Senior', role: 'patient' });
    const u3 = await User.create({ phone: '+9198555003', name: 'Emergency', role: 'patient' });
    const u4 = await User.create({ phone: '+9198555004', name: 'Norm2', role: 'patient' });

    // Join in order: normal, senior (1), emergency (2), normal
    const t1 = await queueService.joinQueue({ serviceId: service._id, userId: u1._id, priority: 0 });
    const t2 = await queueService.joinQueue({ serviceId: service._id, userId: u2._id, priority: 1 });
    const t3 = await queueService.joinQueue({ serviceId: service._id, userId: u3._id, priority: 2 });
    const t4 = await queueService.joinQueue({ serviceId: service._id, userId: u4._id, priority: 0 });

    const c1 = await Counter.create({ serviceId: service._id, name: 'C1', status: 'active' });
    const c2 = await Counter.create({ serviceId: service._id, name: 'C2', status: 'active' });
    const c3 = await Counter.create({ serviceId: service._id, name: 'C3', status: 'active' });
    const c4 = await Counter.create({ serviceId: service._id, name: 'C4', status: 'active' });

    const call1 = await queueService.callNext({ counterId: c1._id });
    const call2 = await queueService.callNext({ counterId: c2._id });
    const call3 = await queueService.callNext({ counterId: c3._id });
    const call4 = await queueService.callNext({ counterId: c4._id });

    // 1st: emergency (priority 2, t3)
    expect(String(call1._id)).toBe(String(t3._id));
    expect(call1.priority).toBe(2);

    // 2nd: senior (priority 1, t2)
    expect(String(call2._id)).toBe(String(t2._id));
    expect(call2.priority).toBe(1);

    // 3rd: normal 1 (priority 0, number 1, t1)
    expect(String(call3._id)).toBe(String(t1._id));
    expect(call3.number).toBe(1);

    // 4th: normal 2 (priority 0, number 4, t4)
    expect(String(call4._id)).toBe(String(t4._id));
    expect(call4.number).toBe(4);
  });

  // f. Lifecycle: waiting -> called -> serving -> completed & illegal transitions
  test('f. Lifecycle works, and illegal transitions fail with INVALID_TRANSITION or FORBIDDEN', async () => {
    const org = await Organization.create({ name: 'Hospital F', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });
    const c1 = await Counter.create({ serviceId: service._id, name: 'C1', status: 'active' });
    const c2 = await Counter.create({ serviceId: service._id, name: 'C2', status: 'active' });
    const u1 = await User.create({ phone: '+9198666001', name: 'User 1', role: 'patient' });
    const u2 = await User.create({ phone: '+9198666002', name: 'User 2', role: 'patient' });

    // 1. Join
    const token = await queueService.joinQueue({ serviceId: service._id, userId: u1._id });
    expect(token.status).toBe('waiting');

    // Completing a waiting token fails with INVALID_TRANSITION
    await expect(
      queueService.completeToken({ tokenId: token._id, counterId: c1._id })
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      statusCode: 409,
    });

    // 2. Call next -> called
    const calledToken = await queueService.callNext({ counterId: c1._id });
    expect(calledToken.status).toBe('called');

    // 3. Start serving -> serving
    const servingToken = await queueService.startServing({
      tokenId: calledToken._id,
      counterId: c1._id,
    });
    expect(servingToken.status).toBe('serving');
    expect(servingToken.servingAt).toBeDefined();

    // Cancelling a serving token fails with INVALID_TRANSITION
    await expect(
      queueService.cancelToken({ tokenId: servingToken._id, userId: u1._id })
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      statusCode: 409,
    });

    // Another counter completing the token fails with FORBIDDEN
    await expect(
      queueService.completeToken({ tokenId: servingToken._id, counterId: c2._id })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });

    // 4. Proper completion by c1 -> completed
    const completedToken = await queueService.completeToken({
      tokenId: servingToken._id,
      counterId: c1._id,
    });
    expect(completedToken.status).toBe('completed');
    expect(completedToken.completedAt).toBeDefined();
    expect(completedToken.isActive).toBe(false);
    expect(completedToken.isHoldingCounter).toBe(false);

    // Another user cancelling a waiting token fails with FORBIDDEN
    const waitingToken2 = await queueService.joinQueue({ serviceId: service._id, userId: u1._id });
    await expect(
      queueService.cancelToken({ tokenId: waitingToken2._id, userId: u2._id })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  // g. getTokenStatus returns correct peopleAhead for mix of priorities
  test('g. getTokenStatus returns the correct peopleAhead for a mix of priorities', async () => {
    const org = await Organization.create({ name: 'Hospital G', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });

    const users = await User.insertMany([
      { phone: '+9198777001', name: 'P1', role: 'patient' },
      { phone: '+9198777002', name: 'P2', role: 'patient' },
      { phone: '+9198777003', name: 'P3', role: 'patient' },
      { phone: '+9198777004', name: 'P4', role: 'patient' },
      { phone: '+9198777005', name: 'P5', role: 'patient' },
      { phone: '+9198777006', name: 'P6', role: 'patient' },
    ]);

    // Priority mix:
    // A: norm (0), #1
    // B: emerg (2), #2
    // C: senior (1), #3
    // D: norm (0), #4
    // E: senior (1), #5
    // F: emerg (2), #6
    const tA = await queueService.joinQueue({ serviceId: service._id, userId: users[0]._id, priority: 0 });
    const tB = await queueService.joinQueue({ serviceId: service._id, userId: users[1]._id, priority: 2 });
    const tC = await queueService.joinQueue({ serviceId: service._id, userId: users[2]._id, priority: 1 });
    const tD = await queueService.joinQueue({ serviceId: service._id, userId: users[3]._id, priority: 0 });
    const tE = await queueService.joinQueue({ serviceId: service._id, userId: users[4]._id, priority: 1 });
    const tF = await queueService.joinQueue({ serviceId: service._id, userId: users[5]._id, priority: 2 });

    // Order: B(emerg, #2), F(emerg, #6), C(senior, #3), E(senior, #5), A(norm, #1), D(norm, #4)
    const statusB = await queueService.getTokenStatus(tB._id);
    const statusF = await queueService.getTokenStatus(tF._id);
    const statusC = await queueService.getTokenStatus(tC._id);
    const statusE = await queueService.getTokenStatus(tE._id);
    const statusA = await queueService.getTokenStatus(tA._id);
    const statusD = await queueService.getTokenStatus(tD._id);

    expect(statusB.peopleAhead).toBe(0);
    expect(statusF.peopleAhead).toBe(1); // B is ahead
    expect(statusC.peopleAhead).toBe(2); // B, F are ahead
    expect(statusE.peopleAhead).toBe(3); // B, F, C are ahead
    expect(statusA.peopleAhead).toBe(4); // B, F, C, E are ahead
    expect(statusD.peopleAhead).toBe(5); // B, F, C, E, A are ahead
  });

  // h. Race: cancel and call-next fire at the same time on a queue with one waiting token (repeat 20 times)
  test('h. Race: cancel and call-next in parallel (20 iterations): token ends cancelled and counter stays free', async () => {
    const org = await Organization.create({ name: 'Hospital H', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });
    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Desk H',
      status: 'active',
    });
    const user = await User.create({
      phone: '+9198888001',
      name: 'Race User',
      role: 'patient',
    });

    for (let i = 0; i < 20; i++) {
      // Clear tokens and sequence for clean iteration
      await Token.deleteMany({});
      await TokenSequence.deleteMany({});
      await Counter.updateOne({ _id: counter._id }, { currentTokenId: null });

      const token = await queueService.joinQueue({
        serviceId: service._id,
        userId: user._id,
        priority: 0,
      });

      // Fire cancel and callNext in parallel
      await Promise.allSettled([
        queueService.cancelToken({ tokenId: token._id, userId: user._id }),
        queueService.callNext({ counterId: counter._id }),
      ]);

      // Invariant 1: Token in database must be cancelled and inactive
      const finalToken = await Token.findById(token._id);
      expect(finalToken.status).toBe('cancelled');
      expect(finalToken.isActive).toBe(false);
      expect(finalToken.isHoldingCounter).toBe(false);

      // Invariant 2: Counter must be free — a further call-next must return QUEUE_EMPTY, never COUNTER_BUSY
      await expect(
        queueService.callNext({ counterId: counter._id })
      ).rejects.toMatchObject({
        code: 'QUEUE_EMPTY',
        statusCode: 409,
      });
    }
  });
});
