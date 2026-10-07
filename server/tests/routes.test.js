const mongoose = require('mongoose');
const app = require('../src/app');
const { Organization, Service, Counter, User, Token, TokenSequence } = require('../src/models');
const { signToken } = require('../src/middleware/auth');
const { getQueueDate } = require('../src/utils/queueDate');

const TEST_MONGO_URI = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

jest.setTimeout(45000);

let server;
let baseUrl;

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

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) server.close();
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

describe('REST Routes with Authentication & Authorization', () => {
  test('Full authenticated HTTP flow: join -> get status -> call-next -> start -> complete', async () => {
    const org = await Organization.create({ name: 'Hospital', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'General OPD',
      isActive: true,
    });
    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Desk 1',
      status: 'active',
    });
    const patientUser = await User.create({
      phone: '+919900011111',
      name: 'Patient 1',
      role: 'patient',
    });
    const staffUser = await User.create({
      phone: '+919900011112',
      name: 'Staff 1',
      role: 'staff',
      organizationId: org._id,
    });

    const patientToken = signToken(patientUser);
    const staffToken = signToken(staffUser);

    // 1. POST /api/services/:serviceId/tokens (patient joins with Bearer token)
    const joinRes = await fetch(`${baseUrl}/api/services/${service._id}/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(joinRes.status).toBe(201);
    const joinData = await joinRes.json();
    expect(joinData.token).toBeDefined();
    expect(joinData.token.number).toBe(1);
    expect(joinData.token.status).toBe('waiting');

    const tokenId = joinData.token._id;

    // 2. GET /api/tokens/:tokenId (patient checks own token)
    const getRes = await fetch(`${baseUrl}/api/tokens/${tokenId}`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.token._id).toBe(tokenId);
    expect(getData.peopleAhead).toBe(0);

    // 3. POST /api/counters/:counterId/call-next (staff calls next)
    const callRes = await fetch(`${baseUrl}/api/counters/${counter._id}/call-next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(callRes.status).toBe(200);
    const callData = await callRes.json();
    expect(callData.token.status).toBe('called');
    expect(callData.token.counterId).toBe(counter._id.toString());

    // 4. POST /api/tokens/:tokenId/start (staff starts serving)
    const startRes = await fetch(`${baseUrl}/api/tokens/${tokenId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({ counterId: counter._id.toString() }),
    });
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    expect(startData.token.status).toBe('serving');

    // 5. POST /api/tokens/:tokenId/complete (staff completes token)
    const completeRes = await fetch(`${baseUrl}/api/tokens/${tokenId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({ counterId: counter._id.toString() }),
    });
    expect(completeRes.status).toBe(200);
    const completeData = await completeRes.json();
    expect(completeData.token.status).toBe('completed');
  });

  test('Input validation errors return 400 with VALIDATION_ERROR code', async () => {
    const patientUser = await User.create({
      phone: '+919900011119',
      name: 'Patient V',
      role: 'patient',
    });
    const patientToken = signToken(patientUser);

    // Invalid ObjectId format
    const res = await fetch(`${baseUrl}/api/services/invalid-id/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  test('Token cancel route: user can cancel own waiting token using JWT', async () => {
    const org = await Organization.create({ name: 'Hospital', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'OPD',
      isActive: true,
    });
    const user = await User.create({
      phone: '+919900022222',
      name: 'Patient 2',
      role: 'patient',
    });
    const patientToken = signToken(user);

    const token = await Token.create({
      serviceId: service._id,
      userId: user._id,
      number: 1,
      queueDate: '2026-10-07',
      status: 'waiting',
      priority: 0,
      isActive: true,
      isHoldingCounter: false,
    });

    const cancelRes = await fetch(`${baseUrl}/api/tokens/${token._id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({}),
    });

    expect(cancelRes.status).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.token.status).toBe('cancelled');
  });

  test('Patient gets 403 on GET /api/counters and GET /api/counters/:counterId/dashboard', async () => {
    const org = await Organization.create({ name: 'Hospital', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'General OPD',
      isActive: true,
    });
    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Counter 1',
      status: 'active',
    });
    const patientUser = await User.create({
      phone: '+919900033331',
      name: 'Patient Test',
      role: 'patient',
    });
    const patientToken = signToken(patientUser);

    // GET /api/counters
    const countersRes = await fetch(`${baseUrl}/api/counters`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    expect(countersRes.status).toBe(403);

    // GET /api/counters/:counterId/dashboard
    const dashRes = await fetch(`${baseUrl}/api/counters/${counter._id}/dashboard`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    expect(dashRes.status).toBe(403);
  });

  test('Staff of another organization gets 403 on GET /api/counters/:counterId/dashboard', async () => {
    const orgA = await Organization.create({ name: 'Hospital A', type: 'hospital' });
    const orgB = await Organization.create({ name: 'Hospital B', type: 'hospital' });
    const serviceA = await Service.create({
      organizationId: orgA._id,
      name: 'OPD A',
      isActive: true,
    });
    const counterA = await Counter.create({
      serviceId: serviceA._id,
      name: 'Counter A',
      status: 'active',
    });
    const staffB = await User.create({
      phone: '+919900033332',
      name: 'Staff Org B',
      role: 'staff',
      organizationId: orgB._id,
    });
    const staffBToken = signToken(staffB);

    const dashRes = await fetch(`${baseUrl}/api/counters/${counterA._id}/dashboard`, {
      headers: { Authorization: `Bearer ${staffBToken}` },
    });
    expect(dashRes.status).toBe(403);
    const dashData = await dashRes.json();
    expect(dashData.error.code).toBe('FORBIDDEN');
  });

  test('/api/services lists only active services with waitingCount computed via single aggregation', async () => {
    const org = await Organization.create({ name: 'City Hospital', type: 'hospital' });
    const activeService1 = await Service.create({
      organizationId: org._id,
      name: 'Pediatrics',
      isActive: true,
    });
    const activeService2 = await Service.create({
      organizationId: org._id,
      name: 'Dental',
      isActive: true,
    });
    const inactiveService = await Service.create({
      organizationId: org._id,
      name: 'Dermatology',
      isActive: false,
    });

    const user = await User.create({
      phone: '+919900033333',
      name: 'User 1',
      role: 'patient',
    });
    const token = signToken(user);
    const today = getQueueDate();

    // Create 2 waiting tokens for Pediatrics
    const p1 = await User.create({ phone: '+919900033334', name: 'P1', role: 'patient' });
    const p2 = await User.create({ phone: '+919900033335', name: 'P2', role: 'patient' });
    await Token.create({
      serviceId: activeService1._id,
      userId: p1._id,
      number: 1,
      queueDate: today,
      status: 'waiting',
      priority: 0,
    });
    await Token.create({
      serviceId: activeService1._id,
      userId: p2._id,
      number: 2,
      queueDate: today,
      status: 'waiting',
      priority: 0,
    });

    // Create 1 waiting token for Inactive service
    const p3 = await User.create({ phone: '+919900033336', name: 'P3', role: 'patient' });
    await Token.create({
      serviceId: inactiveService._id,
      userId: p3._id,
      number: 1,
      queueDate: today,
      status: 'waiting',
      priority: 0,
    });

    const res = await fetch(`${baseUrl}/api/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const services = await res.json();
    expect(Array.isArray(services)).toBe(true);

    // Only active services returned
    const names = services.map((s) => s.name);
    expect(names).toContain('Pediatrics');
    expect(names).toContain('Dental');
    expect(names).not.toContain('Dermatology');

    const pediatrics = services.find((s) => s.name === 'Pediatrics');
    expect(pediatrics.waitingCount).toBe(2);
    expect(pediatrics.organizationName).toBe('City Hospital');

    const dental = services.find((s) => s.name === 'Dental');
    expect(dental.waitingCount).toBe(0);
  });

  test('GET /api/counters/:counterId/dashboard waiting list is in call order and capped at 20', async () => {
    const org = await Organization.create({ name: 'Central OPD', type: 'hospital' });
    const service = await Service.create({
      organizationId: org._id,
      name: 'General',
      isActive: true,
    });
    const counter = await Counter.create({
      serviceId: service._id,
      name: 'Counter 1',
      status: 'active',
    });
    const staff = await User.create({
      phone: '+919900033337',
      name: 'Staff Central',
      role: 'staff',
      organizationId: org._id,
    });
    const staffToken = signToken(staff);
    const today = getQueueDate();

    // Create 25 tokens with mixed priorities
    // e.g., i % 3 gives priorities 0, 1, 2
    for (let i = 1; i <= 25; i++) {
      const u = await User.create({
        phone: `+9199000444${String(i).padStart(2, '0')}`,
        name: `Patient_${i}`,
        role: 'patient',
      });
      const priority = i % 3; // 0, 1, or 2
      await Token.create({
        serviceId: service._id,
        userId: u._id,
        number: i,
        queueDate: today,
        status: 'waiting',
        priority,
      });
    }

    const res = await fetch(`${baseUrl}/api/counters/${counter._id}/dashboard`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(res.status).toBe(200);
    const dash = await res.json();

    expect(dash.waitingCount).toBe(25);
    expect(dash.waiting.length).toBe(20); // capped at 20

    // Verify ordering: priority desc, number asc
    for (let i = 0; i < dash.waiting.length - 1; i++) {
      const a = dash.waiting[i];
      const b = dash.waiting[i + 1];
      if (a.priority === b.priority) {
        expect(a.number).toBeLessThan(b.number);
      } else {
        expect(a.priority).toBeGreaterThan(b.priority);
      }
      expect(a.patientName).toBeDefined();
      expect(typeof a.patientName).toBe('string');
    }
  });
});
