const mongoose = require('mongoose');
const { Organization, Service, Counter, User, Token, TokenSequence } = require('../src/models');
const { seed } = require('../src/scripts/seed');

const TEST_MONGO_URI = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

jest.setTimeout(45000);

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
});

afterAll(async () => {
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

describe('Database Seed & Counter Reconciliation', () => {
  test('a fresh database gets exactly 1 counter', async () => {
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });

    const counters = await Counter.find({});
    expect(counters).toHaveLength(1);
    expect(counters[0].name).toBe('Counter 1');
    expect(counters[0].status).toBe('active');

    expect(await Organization.countDocuments()).toBe(1);
    expect(await Service.countDocuments()).toBe(1);
    expect(await User.countDocuments({ role: 'staff' })).toBe(1);
    expect(await User.countDocuments({ role: 'patient' })).toBe(5);
  });

  test('running the seed twice changes nothing', async () => {
    // First run
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });
    const c1First = await Counter.findOne({ name: 'Counter 1' });
    const staffFirst = await User.findOne({ role: 'staff' });

    // Second run
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });
    const counters = await Counter.find({});
    expect(counters).toHaveLength(1);
    expect(counters[0]._id.toString()).toBe(c1First._id.toString());
    expect(counters[0].status).toBe('active');

    const staffSecond = await User.findOne({ role: 'staff' });
    expect(staffSecond._id.toString()).toBe(staffFirst._id.toString());
    expect(await Organization.countDocuments()).toBe(1);
    expect(await Service.countDocuments()).toBe(1);
    expect(await User.countDocuments({ role: 'patient' })).toBe(5);
  });

  test('an unused Counter 2 is deleted', async () => {
    // Initial seed
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });

    const service = await Service.findOne({ name: 'General OPD' });
    // Manually create an unused Counter 2 (from a previous seed)
    const c2 = await Counter.create({
      serviceId: service._id,
      name: 'Counter 2',
      status: 'active',
    });
    expect(await Counter.countDocuments()).toBe(2);

    // Run seed again
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });

    // Counter 2 should be deleted because no token ever referenced it
    expect(await Counter.findById(c2._id)).toBeNull();
    const counters = await Counter.find({});
    expect(counters).toHaveLength(1);
    expect(counters[0].name).toBe('Counter 1');
    expect(counters[0].status).toBe('active');
  });

  test('a Counter 3 referenced by a completed token becomes offline', async () => {
    // Initial seed
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });

    const service = await Service.findOne({ name: 'General OPD' });
    const c3 = await Counter.create({
      serviceId: service._id,
      name: 'Counter 3',
      status: 'active',
    });

    // Create a historical completed token that referenced Counter 3
    const patient = await User.findOne({ role: 'patient' });
    await Token.create({
      serviceId: service._id,
      userId: patient._id,
      number: 10,
      queueDate: '2026-10-10',
      status: 'completed',
      isActive: false,
      isHoldingCounter: false,
      counterId: c3._id,
    });

    // Run seed again
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });

    // Counter 3 should become offline to preserve history
    const updatedC3 = await Counter.findById(c3._id);
    expect(updatedC3).not.toBeNull();
    expect(updatedC3.status).toBe('offline');
    expect(updatedC3.name).toBe('Counter 3');

    // Counter 1 remains active
    const c1 = await Counter.findOne({ name: 'Counter 1' });
    expect(c1.status).toBe('active');
  });

  test('a Counter 2 holding a called token is left alone with a warning', async () => {
    // Initial seed
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });

    const service = await Service.findOne({ name: 'General OPD' });
    const c2 = await Counter.create({
      serviceId: service._id,
      name: 'Counter 2',
      status: 'active',
    });

    // Create a called token currently on Counter 2
    const patient = await User.findOne({ role: 'patient' });
    await Token.create({
      serviceId: service._id,
      userId: patient._id,
      number: 12,
      queueDate: '2026-10-13',
      status: 'called',
      isActive: true,
      isHoldingCounter: true,
      counterId: c2._id,
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Run seed again
    await seed({
      mongoUri: TEST_MONGO_URI,
      closeConnection: false,
      exitOnError: false,
    });

    // Counter 2 should remain active and untouched
    const updatedC2 = await Counter.findById(c2._id);
    expect(updatedC2).not.toBeNull();
    expect(updatedC2.status).toBe('active');

    // Warning was logged telling to finish or skip that token first
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Counter "Counter 2" has an active token \(status: called\).*finish or skip/i)
    );

    warnSpy.mockRestore();
  });
});
