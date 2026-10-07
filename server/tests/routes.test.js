const mongoose = require('mongoose');
const app = require('../src/app');
const { Organization, Service, Counter, User, Token, TokenSequence } = require('../src/models');

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

describe('REST Routes', () => {
  test('Full HTTP flow: join -> get status -> call-next -> start -> complete', async () => {
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
    const user = await User.create({
      phone: '+919900011111',
      name: 'Patient 1',
      role: 'patient',
    });

    // 1. POST /api/services/:serviceId/tokens
    const joinRes = await fetch(`${baseUrl}/api/services/${service._id}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user._id.toString(), priority: 0 }),
    });
    expect(joinRes.status).toBe(201);
    const joinData = await joinRes.json();
    expect(joinData.token).toBeDefined();
    expect(joinData.token.number).toBe(1);
    expect(joinData.token.status).toBe('waiting');

    const tokenId = joinData.token._id;

    // 2. GET /api/tokens/:tokenId
    const getRes = await fetch(`${baseUrl}/api/tokens/${tokenId}`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.token._id).toBe(tokenId);
    expect(getData.peopleAhead).toBe(0);

    // 3. POST /api/counters/:counterId/call-next
    const callRes = await fetch(`${baseUrl}/api/counters/${counter._id}/call-next`, {
      method: 'POST',
    });
    expect(callRes.status).toBe(200);
    const callData = await callRes.json();
    expect(callData.token.status).toBe('called');
    expect(callData.token.counterId).toBe(counter._id.toString());

    // 4. POST /api/tokens/:tokenId/start
    const startRes = await fetch(`${baseUrl}/api/tokens/${tokenId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counterId: counter._id.toString() }),
    });
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    expect(startData.token.status).toBe('serving');

    // 5. POST /api/tokens/:tokenId/complete
    const completeRes = await fetch(`${baseUrl}/api/tokens/${tokenId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counterId: counter._id.toString() }),
    });
    expect(completeRes.status).toBe(200);
    const completeData = await completeRes.json();
    expect(completeData.token.status).toBe('completed');
  });

  test('Input validation errors return 400 with VALIDATION_ERROR code', async () => {
    // Invalid ObjectId format
    const res = await fetch(`${baseUrl}/api/services/invalid-id/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'invalid', priority: 5 }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  test('Token cancel route: user can cancel own waiting token', async () => {
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user._id.toString() }),
    });

    expect(cancelRes.status).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.token.status).toBe('cancelled');
  });
});
