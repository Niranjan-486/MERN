const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');
const app = require('../src/app');
const { createRealtime } = require('../src/realtime');
const { Organization, Service, Counter, User, Token, TokenSequence } = require('../src/models');
const { signToken } = require('../src/middleware/auth');
const queueService = require('../src/services/queueService');
const env = require('../src/config/env');

const TEST_MONGO_URI = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/smartqueue_test';

jest.setTimeout(45000);

let httpServer;
let ioServer;
let serverUrl;
const openSockets = [];

/**
 * Creates and tracks a Socket.io client connection for clean teardown.
 */
function createClientSocket(token) {
  const socket = Client(serverUrl, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  openSockets.push(socket);
  return socket;
}

/**
 * Helper to wait until no events are received on a socket or array of sockets for quietMs.
 */
function waitForQuiet(socketOrSockets, quietMs = 300) {
  const sockets = Array.isArray(socketOrSockets) ? socketOrSockets : [socketOrSockets];
  return new Promise((resolve) => {
    let timer;
    const onEvent = () => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    };
    const done = () => {
      for (const s of sockets) {
        s.offAny(onEvent);
      }
      resolve();
    };
    for (const s of sockets) {
      s.onAny(onEvent);
    }
    timer = setTimeout(done, quietMs);
  });
}

/**
 * Wait for socket to connect.
 */
function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
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

  httpServer = http.createServer(app);
  ioServer = createRealtime(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  serverUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  for (const s of openSockets) {
    if (s.connected) s.disconnect();
  }
  openSockets.length = 0;

  if (ioServer) {
    ioServer.cleanup();
    await new Promise((resolve) => ioServer.close(resolve));
  }
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await mongoose.connection.close();
});

beforeEach(async () => {
  for (const s of openSockets) {
    if (s.connected) s.disconnect();
  }
  openSockets.length = 0;

  await Promise.all([
    Organization.deleteMany({}),
    Service.deleteMany({}),
    Counter.deleteMany({}),
    User.deleteMany({}),
    Token.deleteMany({}),
    TokenSequence.deleteMany({}),
  ]);
});

describe('Realtime Layer & Authentication Integration Tests', () => {
  // a. Auth tests
  test('a. Auth: no token -> 401; wrong OTP -> 401; patient call-next -> 403; cross-org counter -> 403; cross-user token read/cancel -> 403; patient priority ignored; 10 parallel verify-otp for new phone', async () => {
    const orgA = await Organization.create({ name: 'Org A', type: 'hospital' });
    const orgB = await Organization.create({ name: 'Org B', type: 'hospital' });
    const serviceA = await Service.create({ organizationId: orgA._id, name: 'Service A' });
    const counterA = await Counter.create({ serviceId: serviceA._id, name: 'C1', status: 'active' });

    const patient1 = await User.create({ phone: '919000000001', name: 'Patient 1', role: 'patient' });
    const patient2 = await User.create({ phone: '919000000002', name: 'Patient 2', role: 'patient' });
    const staffB = await User.create({
      phone: '919000000003',
      name: 'Staff B',
      role: 'staff',
      organizationId: orgB._id,
    });

    const tokenP1 = signToken(patient1);
    const tokenP2 = signToken(patient2);
    const tokenSB = signToken(staffB);

    // 1. No token -> 401
    const noTokenRes = await fetch(`${serverUrl}/api/me`);
    expect(noTokenRes.status).toBe(401);
    const noTokenData = await noTokenRes.json();
    expect(noTokenData.error.code).toBe('UNAUTHENTICATED');

    // 2. Wrong OTP -> 401
    const wrongOtpRes = await fetch(`${serverUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '919000000001', otp: 'wrongcode' }),
    });
    expect(wrongOtpRes.status).toBe(401);
    const wrongOtpData = await wrongOtpRes.json();
    expect(wrongOtpData.error.code).toBe('INVALID_OTP');

    // 3. Patient calling call-next -> 403
    const patientCallRes = await fetch(`${serverUrl}/api/counters/${counterA._id}/call-next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenP1}` },
    });
    expect(patientCallRes.status).toBe(403);
    const patientCallData = await patientCallRes.json();
    expect(patientCallData.error.code).toBe('FORBIDDEN');

    // 4. Staff of org B operating org A counter -> 403
    const staffCrossRes = await fetch(`${serverUrl}/api/counters/${counterA._id}/call-next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSB}` },
    });
    expect(staffCrossRes.status).toBe(403);
    const staffCrossData = await staffCrossRes.json();
    expect(staffCrossData.error.code).toBe('FORBIDDEN');

    // 5. Patient-supplied priority is ignored for patient joins
    const joinRes = await fetch(`${serverUrl}/api/services/${serviceA._id}/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenP1}`,
      },
      body: JSON.stringify({ priority: 2 }), // patient tries emergency
    });
    expect(joinRes.status).toBe(201);
    const joinData = await joinRes.json();
    expect(joinData.token.priority).toBe(0); // forced to 0
    const token1Id = joinData.token._id;

    // 6. Patient 2 cannot read Patient 1's token -> 403
    const readRes = await fetch(`${serverUrl}/api/tokens/${token1Id}`, {
      headers: { Authorization: `Bearer ${tokenP2}` },
    });
    expect(readRes.status).toBe(403);
    const readData = await readRes.json();
    expect(readData.error.code).toBe('FORBIDDEN');

    // 7. Patient 2 cannot cancel Patient 1's token -> 403
    const cancelRes = await fetch(`${serverUrl}/api/tokens/${token1Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenP2}` },
    });
    expect(cancelRes.status).toBe(403);
    const cancelData = await cancelRes.json();
    expect(cancelData.error.code).toBe('FORBIDDEN');

    // 8. 10 parallel verify-otp calls for brand-new phone create exactly one user and all succeed
    const newPhone = '919777777777';
    const verifyPromises = Array.from({ length: 10 }).map(() =>
      fetch(`${serverUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: newPhone, otp: env.OTP_CODE }),
      })
    );
    const verifyResponses = await Promise.all(verifyPromises);
    for (const r of verifyResponses) {
      expect(r.status).toBe(200);
      const data = await r.json();
      expect(data.token).toBeDefined();
      expect(data.user.role).toBe('patient');
    }
    const createdUsers = await User.find({ phone: newPhone });
    expect(createdUsers).toHaveLength(1);
  });

  // b. Socket without valid JWT is refused
  test('b. A socket without a valid JWT is refused', async () => {
    const socket = createClientSocket('invalid.jwt.token');
    const err = await new Promise((resolve) => {
      socket.on('connect_error', resolve);
    });
    expect(err).toBeDefined();
    expect(err.message).toMatch(/Invalid or expired authentication token|Authentication token required/);
  });

  // c. Lifecycle updates received by patient socket
  test('c. A patient socket receives token:updated through join -> called -> serving -> completed in order with right peopleAhead', async () => {
    const org = await Organization.create({ name: 'Hospital C', type: 'hospital' });
    const service = await Service.create({ organizationId: org._id, name: 'OPD C' });
    const counter = await Counter.create({ serviceId: service._id, name: 'Room 101', status: 'active' });
    const patient = await User.create({ phone: '919111111111', name: 'Patient C', role: 'patient' });
    const staff = await User.create({ phone: '919111111112', name: 'Staff C', role: 'staff', organizationId: org._id });

    const patientToken = signToken(patient);
    const staffToken = signToken(staff);

    const socket = createClientSocket(patientToken);
    await waitForConnect(socket);

    const receivedStates = [];
    socket.on('token:updated', (data) => {
      receivedStates.push(data);
    });

    // 1. Join queue
    const joinRes = await fetch(`${serverUrl}/api/services/${service._id}/tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const joinData = await joinRes.json();
    const tokenId = joinData.token._id;

    // 2. Staff calls next
    await fetch(`${serverUrl}/api/counters/${counter._id}/call-next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
    });

    // 3. Staff starts serving
    await fetch(`${serverUrl}/api/tokens/${tokenId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ counterId: counter._id.toString() }),
    });

    // 4. Staff completes token
    await fetch(`${serverUrl}/api/tokens/${tokenId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ counterId: counter._id.toString() }),
    });

    await waitForQuiet(socket, 300);

    // Extract sequence of distinct statuses
    const statuses = [];
    for (const event of receivedStates) {
      if (statuses[statuses.length - 1] !== event.status) {
        statuses.push(event.status);
      }
    }

    expect(statuses).toEqual(['waiting', 'called', 'serving', 'completed']);

    // Check payload details:
    const waitingEvt = receivedStates.find((e) => e.status === 'waiting');
    expect(waitingEvt.peopleAhead).toBe(0);
    expect(waitingEvt.counterName).toBeNull();

    const calledEvt = receivedStates.find((e) => e.status === 'called');
    expect(calledEvt.peopleAhead).toBeNull();
    expect(calledEvt.counterName).toBe('Room 101');
  });

  // d. A, B, C waiting; staff calls next: A gets called, B and C receive peopleAhead 0 and 1
  test('d. A, B, C waiting; staff calls next: A gets called, and B and C receive peopleAhead 0 and 1', async () => {
    const org = await Organization.create({ name: 'Hospital D', type: 'hospital' });
    const service = await Service.create({ organizationId: org._id, name: 'OPD D' });
    const counter = await Counter.create({ serviceId: service._id, name: 'Counter D', status: 'active' });

    const uA = await User.create({ phone: '919222222201', name: 'User A', role: 'patient' });
    const uB = await User.create({ phone: '919222222202', name: 'User B', role: 'patient' });
    const uC = await User.create({ phone: '919222222203', name: 'User C', role: 'patient' });
    const staff = await User.create({ phone: '919222222204', name: 'Staff D', role: 'staff', organizationId: org._id });

    const sockA = createClientSocket(signToken(uA));
    const sockB = createClientSocket(signToken(uB));
    const sockC = createClientSocket(signToken(uC));
    await Promise.all([waitForConnect(sockA), waitForConnect(sockB), waitForConnect(sockC)]);

    const eventsA = [];
    const eventsB = [];
    const eventsC = [];
    sockA.on('token:updated', (d) => eventsA.push(d));
    sockB.on('token:updated', (d) => eventsB.push(d));
    sockC.on('token:updated', (d) => eventsC.push(d));

    // Join A, B, C in order
    await queueService.joinQueue({ serviceId: service._id, userId: uA._id, priority: 0 });
    await queueService.joinQueue({ serviceId: service._id, userId: uB._id, priority: 0 });
    await queueService.joinQueue({ serviceId: service._id, userId: uC._id, priority: 0 });

    await waitForQuiet([sockA, sockB, sockC], 300);

    // Staff calls next -> A is called
    await queueService.callNext({ counterId: counter._id });

    await waitForQuiet([sockA, sockB, sockC], 300);

    const lastA = eventsA[eventsA.length - 1];
    const lastB = eventsB[eventsB.length - 1];
    const lastC = eventsC[eventsC.length - 1];

    expect(lastA.status).toBe('called');
    expect(lastB.status).toBe('waiting');
    expect(lastB.peopleAhead).toBe(0);
    expect(lastC.status).toBe('waiting');
    expect(lastC.peopleAhead).toBe(1);
  });

  // e. Isolation
  test('e. Isolation: patient never receives other patient token; org B staff never receives org A queue update; uninvolved patient never receives queue:updated', async () => {
    const orgA = await Organization.create({ name: 'Hospital EA', type: 'hospital' });
    const orgB = await Organization.create({ name: 'Hospital EB', type: 'hospital' });
    const serviceA = await Service.create({ organizationId: orgA._id, name: 'Service A' });
    const counterA = await Counter.create({ serviceId: serviceA._id, name: 'CA', status: 'active' });

    const u1 = await User.create({ phone: '919333333301', name: 'User 1', role: 'patient' });
    const u2 = await User.create({ phone: '919333333302', name: 'User 2', role: 'patient' });
    const uUninvolved = await User.create({ phone: '919333333303', name: 'User Uninvolved', role: 'patient' });
    const staffB = await User.create({ phone: '919333333304', name: 'Staff B', role: 'staff', organizationId: orgB._id });

    const sock1 = createClientSocket(signToken(u1));
    const sock2 = createClientSocket(signToken(u2));
    const sockUninvolved = createClientSocket(signToken(uUninvolved));
    const sockStaffB = createClientSocket(signToken(staffB));

    await Promise.all([
      waitForConnect(sock1),
      waitForConnect(sock2),
      waitForConnect(sockUninvolved),
      waitForConnect(sockStaffB),
    ]);

    const u1TokenUpdates = [];
    const staffBQueueUpdates = [];
    const uninvolvedQueueUpdates = [];

    sock1.on('token:updated', (d) => u1TokenUpdates.push(d));
    sockStaffB.on('queue:updated', (d) => staffBQueueUpdates.push(d));
    sockUninvolved.on('queue:updated', (d) => uninvolvedQueueUpdates.push(d));

    // U2 joins Service A
    const t2 = await queueService.joinQueue({ serviceId: serviceA._id, userId: u2._id });
    await queueService.callNext({ counterId: counterA._id });

    await waitForQuiet([sock1, sock2, sockUninvolved, sockStaffB], 300);

    // 1. U1 never receives U2's token updates
    for (const evt of u1TokenUpdates) {
      expect(evt.tokenId).not.toBe(t2._id.toString());
    }

    // 2. Staff B never receives Org A's queue:updated
    expect(staffBQueueUpdates).toHaveLength(0);

    // 3. Uninvolved patient never receives Service A's queue:updated
    expect(uninvolvedQueueUpdates).toHaveLength(0);
  });

  // f. Failed operations emit nothing
  test('f. Failed operations emit nothing: duplicate join, call-next on empty queue', async () => {
    const org = await Organization.create({ name: 'Hospital F', type: 'hospital' });
    const service = await Service.create({ organizationId: org._id, name: 'Service F' });
    const counter = await Counter.create({ serviceId: service._id, name: 'Counter F', status: 'active' });
    const user = await User.create({ phone: '919444444401', name: 'User F', role: 'patient' });

    const socket = createClientSocket(signToken(user));
    await waitForConnect(socket);

    // First join (succeeds)
    await queueService.joinQueue({ serviceId: service._id, userId: user._id });
    await waitForQuiet(socket, 300);

    const eventsDuringFailure = [];
    socket.onAny((event, data) => eventsDuringFailure.push({ event, data }));

    // Failed duplicate join
    await expect(
      queueService.joinQueue({ serviceId: service._id, userId: user._id })
    ).rejects.toMatchObject({ code: 'ALREADY_IN_QUEUE' });

    // Call next once to empty the waiting queue
    await queueService.callNext({ counterId: counter._id });
    await waitForQuiet(socket, 300);

    // Reset event counter
    eventsDuringFailure.length = 0;

    // Failed call next on empty queue (with free counter in another counter)
    const counter2 = await Counter.create({ serviceId: service._id, name: 'Counter F2', status: 'active' });
    await expect(
      queueService.callNext({ counterId: counter2._id })
    ).rejects.toMatchObject({ code: 'QUEUE_EMPTY' });

    await waitForQuiet(socket, 300);

    expect(eventsDuringFailure).toHaveLength(0);
  });

  // g. Burst: 100 patients join in parallel, 10 connected by socket
  test('g. Burst: 100 parallel joins, 10 sockets connected; last token:updated matches DB, queue:updated count << 100', async () => {
    const org = await Organization.create({ name: 'Hospital G', type: 'hospital' });
    const service = await Service.create({ organizationId: org._id, name: 'Service G' });

    // Create 100 users
    const users = await User.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        phone: `919555555${String(i).padStart(3, '0')}`,
        name: `Burst ${i}`,
        role: 'patient',
      }))
    );

    // Connect first 10 users by socket
    const connectedSockets = [];
    const lastEvents = new Map();
    let queueUpdateCount = 0;

    for (let i = 0; i < 10; i++) {
      const u = users[i];
      const s = createClientSocket(signToken(u));
      s.on('token:updated', (data) => {
        lastEvents.set(u._id.toString(), data);
      });
      if (i === 0) {
        s.on('queue:updated', () => {
          queueUpdateCount++;
        });
      }
      connectedSockets.push(s);
    }

    await Promise.all(connectedSockets.map(waitForConnect));

    // 100 patients join in parallel
    await Promise.all(
      users.map((u) => queueService.joinQueue({ serviceId: service._id, userId: u._id }))
    );

    await waitForQuiet(connectedSockets, 300);

    // Each of the 10 connected sockets must have received token:updated matching DB
    expect(lastEvents.size).toBe(10);
    for (let i = 0; i < 10; i++) {
      const uid = users[i]._id.toString();
      const lastEvt = lastEvents.get(uid);
      expect(lastEvt).toBeDefined();
      expect(lastEvt.status).toBe('waiting');

      const tokenInDb = await Token.findById(lastEvt.tokenId);
      expect(tokenInDb.number).toBe(lastEvt.number);
      expect(tokenInDb.status).toBe('waiting');
    }

    // Coalescing check: 100 joins cost far fewer than 100 queue:updated runs
    expect(queueUpdateCount).toBeLessThan(20);
  });

  // h. Reconnect: disconnect patient socket, staff actions, reconnect new socket
  test('h. Reconnect: disconnect patient socket, run staff actions, reconnect socket, check active tokens equals DB and receives live updates', async () => {
    const org = await Organization.create({ name: 'Hospital H', type: 'hospital' });
    const service = await Service.create({ organizationId: org._id, name: 'Service H' });
    const counter = await Counter.create({ serviceId: service._id, name: 'Desk H', status: 'active' });
    const user = await User.create({ phone: '919666666601', name: 'Reconnect User', role: 'patient' });
    const staff = await User.create({ phone: '919666666602', name: 'Staff H', role: 'staff', organizationId: org._id });

    const patientToken = signToken(user);

    // 1. Connect socket and join
    const sock1 = createClientSocket(patientToken);
    await waitForConnect(sock1);
    const token = await queueService.joinQueue({ serviceId: service._id, userId: user._id });
    await waitForQuiet(sock1, 300);

    // 2. Disconnect socket
    sock1.disconnect();

    // 3. Staff actions while client is offline
    await queueService.callNext({ counterId: counter._id });
    await queueService.startServing({ tokenId: token._id, counterId: counter._id });

    // 4. Client reconnects: checks REST source of truth GET /api/me/tokens/active
    const activeRes = await fetch(`${serverUrl}/api/me/tokens/active`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    expect(activeRes.status).toBe(200);
    const activeData = await activeRes.json();
    expect(activeData).toHaveLength(1);
    expect(activeData[0].status).toBe('serving');
    expect(activeData[0].counterName).toBe('Desk H');

    // 5. Connect new socket (no client-side room joins requested)
    const sock2 = createClientSocket(patientToken);
    await waitForConnect(sock2);

    const sock2Events = [];
    sock2.on('token:updated', (d) => sock2Events.push(d));

    // Staff completes token while new socket is connected
    await queueService.completeToken({ tokenId: token._id, counterId: counter._id });
    await waitForQuiet(sock2, 300);

    // Sock 2 receives the live completed event
    const completedEvt = sock2Events.find((e) => e.status === 'completed');
    expect(completedEvt).toBeDefined();
    expect(completedEvt.tokenId).toBe(token._id.toString());
  });

  // i. getQueueSnapshot and getTokenStatus agree on peopleAhead for mix of priorities
  test('i. getQueueSnapshot and getTokenStatus agree on peopleAhead for mix of priorities', async () => {
    const org = await Organization.create({ name: 'Hospital I', type: 'hospital' });
    const service = await Service.create({ organizationId: org._id, name: 'Service I' });

    const users = await User.insertMany([
      { phone: '919777777701', name: 'I1', role: 'patient' },
      { phone: '919777777702', name: 'I2', role: 'patient' },
      { phone: '919777777703', name: 'I3', role: 'patient' },
      { phone: '919777777704', name: 'I4', role: 'patient' },
      { phone: '919777777705', name: 'I5', role: 'patient' },
    ]);

    // Join with mixed priorities
    const t0 = await queueService.joinQueue({ serviceId: service._id, userId: users[0]._id, priority: 0 });
    const t1 = await queueService.joinQueue({ serviceId: service._id, userId: users[1]._id, priority: 2 });
    const t2 = await queueService.joinQueue({ serviceId: service._id, userId: users[2]._id, priority: 1 });
    const t3 = await queueService.joinQueue({ serviceId: service._id, userId: users[3]._id, priority: 2 });
    const t4 = await queueService.joinQueue({ serviceId: service._id, userId: users[4]._id, priority: 0 });

    const snapshot = await queueService.getQueueSnapshot(service._id);

    expect(snapshot.waitingTokens).toHaveLength(5);

    // For every waiting token in snapshot, verify that its index in the snapshot
    // exactly equals the result of getTokenStatus
    for (let index = 0; index < snapshot.waitingTokens.length; index++) {
      const token = snapshot.waitingTokens[index];
      const statusResult = await queueService.getTokenStatus(token._id);
      expect(statusResult.peopleAhead).toBe(index);
    }
  });
});
