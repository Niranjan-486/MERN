const path = require('path');
module.paths.push(path.resolve(__dirname, '../../server/node_modules'));

const {
  loginUser,
  getServices,
  joinQueue,
  connectSocket,
} = require('../../server/tools/sim/simClient');
const { calculatePercentiles } = require('../../server/tools/sim/percentile');
const { ConvergenceTracker } = require('../../server/tools/sim/convergence');
const { evaluateThresholds } = require('../thresholds');

/**
 * Runs the burst scenario for a given patient count N.
 */
async function runBurstScenario({
  apiUrl,
  simulatorKey,
  patientCount = 100,
  patientCode = '123456',
  serviceId: explicitServiceId,
  onProgress,
}) {
  const log = (msg) => {
    if (typeof onProgress === 'function') onProgress(msg);
  };

  log(`Preparing burst scenario with N=${patientCount} patients...`);

  // 1. Fetch active service
  let serviceId = explicitServiceId;
  let patientAuthTokens = [];

  // Login a probe user to discover services if needed
  if (!serviceId) {
    const probe = await loginUser({
      apiUrl,
      phone: '0000000000',
      otp: patientCode,
      name: 'Probe User',
      simulatorKey,
    });
    const services = await getServices({ apiUrl, token: probe.token });
    const active = services.find((s) => s.isActive) || services[0];
    if (!active) {
      throw new Error('No active service found for benchmark');
    }
    serviceId = active.id || active._id;
  }

  // 2. Pre-authenticate all patients (in concurrency chunks to avoid connection flooding)
  log(`Logging in ${patientCount} simulated patients...`);
  const patients = [];
  const chunkSize = 25;
  for (let i = 1; i <= patientCount; i += chunkSize) {
    const chunkPromises = [];
    for (let j = i; j < i + chunkSize && j <= patientCount; j++) {
      const phone = String(j).padStart(10, '0');
      const name = `Bench Patient ${j}`;
      chunkPromises.push(
        loginUser({
          apiUrl,
          phone,
          otp: patientCode,
          name,
          simulatorKey,
        }).then((res) => ({
          index: j,
          userId: res.user.id || res.user._id,
          token: res.token,
        }))
      );
    }
    const chunkResults = await Promise.all(chunkPromises);
    patients.push(...chunkResults);
  }

  // 3. Connect WebSockets for each patient and subscribe to events
  log(`Connecting ${patientCount} WebSocket connections...`);
  const sockets = [];
  const queueUpdatesPerSocket = new Map();
  const tokenEventsPerUser = new Map();

  for (const p of patients) {
    queueUpdatesPerSocket.set(p.userId, 0);
    tokenEventsPerUser.set(p.userId, []);
  }

  const socketChunkSize = 25;
  for (let i = 0; i < patients.length; i += socketChunkSize) {
    const chunk = patients.slice(i, i + socketChunkSize);
    const chunkPromises = chunk.map(async (p) => {
      try {
        const socket = await connectSocket({ apiUrl, token: p.token, timeoutMs: 15000 });
        socket.on('queue:updated', () => {
          const c = queueUpdatesPerSocket.get(p.userId) || 0;
          queueUpdatesPerSocket.set(p.userId, c + 1);
        });
        socket.on('token:updated', (evt) => {
          const events = tokenEventsPerUser.get(p.userId) || [];
          events.push({ ...evt, receivedAt: Date.now() });
          tokenEventsPerUser.set(p.userId, events);
        });
        sockets.push(socket);
        return socket;
      } catch (err) {
        throw new Error(`Socket connection failed for patient ${p.index}: ${err.message}`);
      }
    });
    await Promise.all(chunkPromises);
  }

  log(`All ${sockets.length} sockets connected. Starting burst queue join...`);

  // 4. Trigger concurrent queue joins
  const burstStartTime = Date.now();
  const joinResults = [];
  let joinErrors = 0;

  const joinPromises = patients.map(async (p) => {
    const reqStart = Date.now();
    try {
      const res = await joinQueue({
        apiUrl,
        token: p.token,
        serviceId,
      });
      const reqDuration = Date.now() - reqStart;
      return {
        success: true,
        userId: p.userId,
        patientIndex: p.index,
        token: res.token,
        durationMs: reqDuration,
      };
    } catch (err) {
      joinErrors++;
      return {
        success: false,
        userId: p.userId,
        patientIndex: p.index,
        error: err.message,
        durationMs: Date.now() - reqStart,
      };
    }
  });

  const rawResults = await Promise.all(joinPromises);
  const burstEndTime = Date.now();
  const totalBurstDurationMs = Math.max(1, burstEndTime - burstStartTime);

  if (joinErrors > 0) {
    const sampleErrors = rawResults.filter((r) => !r.success).map((r) => r.error).slice(0, 5);
    log(`Sample join errors (${joinErrors} total): ${sampleErrors.join(' | ')}`);
  }

  // 5. Convergence tracking
  // Wait up to 10s for all sockets to receive final peopleAhead
  log('Evaluating socket event convergence...');
  const convergenceTimeoutMs = 15000;
  const convWaitStart = Date.now();

  const successfulJoins = rawResults.filter((r) => r.success);
  // Sort successful tokens by number to know exact queue order
  successfulJoins.sort((a, b) => a.token.number - b.token.number);

  const tracker = new ConvergenceTracker(
    successfulJoins.map((j, idx) => ({
      userId: j.userId,
      tokenId: j.token._id || j.token.id,
      expectedPeopleAhead: idx,
    })),
    burstStartTime
  );

  // Process any already received events
  for (const [userId, events] of tokenEventsPerUser.entries()) {
    for (const evt of events) {
      tracker.recordEvent(userId, evt, evt.receivedAt);
    }
  }

  // Poll until converged or timeout
  while (!tracker.isConverged() && Date.now() - convWaitStart < convergenceTimeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
    for (const [userId, events] of tokenEventsPerUser.entries()) {
      for (const evt of events) {
        tracker.recordEvent(userId, evt, evt.receivedAt);
      }
    }
  }

  const convStatus = tracker.getStatus();
  const convergenceTimeMs = convStatus.convergenceTimeMs || (Date.now() - burstStartTime);

  // 6. Contiguity & Duplicate checks
  const tokenNumbers = successfulJoins.map((j) => j.token.number);
  const uniqueNumbers = new Set(tokenNumbers);
  const hasDuplicates = uniqueNumbers.size !== tokenNumbers.length;
  const duplicateCount = tokenNumbers.length - uniqueNumbers.size;

  let isContiguous = tokenNumbers.length > 0;
  if (isContiguous) {
    const minNum = tokenNumbers[0];
    for (let i = 0; i < tokenNumbers.length; i++) {
      if (tokenNumbers[i] !== minNum + i) {
        isContiguous = false;
        break;
      }
    }
  }

  // 7. Queue update coalescing analysis
  const queueUpdateCounts = Array.from(queueUpdatesPerSocket.values());
  const avgQueueUpdates =
    queueUpdateCounts.length > 0
      ? Math.round((queueUpdateCounts.reduce((a, b) => a + b, 0) / queueUpdateCounts.length) * 100) / 100
      : 0;
  const maxQueueUpdates = queueUpdateCounts.length > 0 ? Math.max(...queueUpdateCounts) : 0;
  const minQueueUpdates = queueUpdateCounts.length > 0 ? Math.min(...queueUpdateCounts) : 0;
  const queueUpdateRatio = patientCount > 0 ? avgQueueUpdates / patientCount : 0;

  // 8. Latencies & Throughput
  const durations = successfulJoins.map((j) => j.durationMs);
  const percentiles = calculatePercentiles(durations);
  const throughputReqPerSec =
    Math.round((successfulJoins.length / (totalBurstDurationMs / 1000)) * 100) / 100;

  // 9. Cleanup sockets
  for (const s of sockets) {
    try {
      s.disconnect();
    } catch (_) {}
  }

  const scenarioResult = {
    scenario: 'burst',
    patientCount,
    totalCount: patientCount,
    successfulCount: successfulJoins.length,
    errors: joinErrors,
    durationMs: totalBurstDurationMs,
    throughputReqPerSec,
    percentiles,
    hasDuplicates,
    duplicateCount,
    isContiguous,
    convergenceTimeMs,
    isConverged: convStatus.isConverged,
    coalescing: {
      avgQueueUpdates,
      minQueueUpdates,
      maxQueueUpdates,
      ratio: queueUpdateRatio,
    },
  };

  const evaluation = evaluateThresholds('burst', {
    hasDuplicates,
    duplicateCount,
    isContiguous,
    errors: joinErrors,
    percentiles,
    convergenceTimeMs,
    queueUpdateRatio,
  });

  return {
    ...scenarioResult,
    passed: evaluation.passed,
    failures: evaluation.failures,
  };
}

module.exports = { runBurstScenario };
