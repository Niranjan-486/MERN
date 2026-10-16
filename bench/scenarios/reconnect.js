const path = require('path');
module.paths.push(path.resolve(__dirname, '../../server/node_modules'));

const {
  loginUser,
  getServices,
  joinQueue,
  connectSocket,
  apiRequest,
} = require('../../server/tools/sim/simClient');
const { calculatePercentiles } = require('../../server/tools/sim/percentile');
const { evaluateThresholds } = require('../thresholds');

/**
 * Runs the reconnect storm scenario:
 * 200 patients connected and waiting. All 200 sockets dropped simultaneously.
 * Measures time until all 200 reconnect and complete REST refetch.
 */
async function runReconnectScenario({
  apiUrl,
  simulatorKey,
  patientCount = 200,
  patientCode = '123456',
  onProgress,
}) {
  const log = (msg) => {
    if (typeof onProgress === 'function') onProgress(msg);
  };

  log(`Preparing reconnect scenario with N=${patientCount} waiting patients...`);

  // 1. Discover active service
  const probe = await loginUser({
    apiUrl,
    phone: '0000000000',
    otp: patientCode,
    name: 'Probe Reconnect',
    simulatorKey,
  });
  const services = await getServices({ apiUrl, token: probe.token });
  const activeService = services.find((s) => s.isActive) || services[0];
  if (!activeService) {
    throw new Error('No active service found for reconnect scenario');
  }
  const serviceId = activeService.id || activeService._id;

  // 2. Pre-authenticate patients
  log(`Logging in ${patientCount} simulated patients...`);
  const patients = [];
  const chunkSize = 25;
  for (let i = 1; i <= patientCount; i += chunkSize) {
    const chunkPromises = [];
    for (let j = i; j < i + chunkSize && j <= patientCount; j++) {
      const phone = String(j + 5000).padStart(10, '0');
      const name = `Reconnect Patient ${j}`;
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

  // 3. Connect all WebSockets
  log(`Connecting ${patientCount} WebSocket connections...`);
  const sockets = [];
  for (let i = 0; i < patients.length; i += chunkSize) {
    const chunk = patients.slice(i, i + chunkSize);
    const chunkPromises = chunk.map(async (p) => {
      const socket = await connectSocket({ apiUrl, token: p.token, timeoutMs: 15000 });
      p.socket = socket;
      sockets.push(socket);
      return socket;
    });
    await Promise.all(chunkPromises);
  }

  // 4. Patients join queue
  log(`Enqueuing ${patientCount} patients...`);
  const tokens = [];
  for (let i = 0; i < patients.length; i += chunkSize) {
    const chunk = patients.slice(i, i + chunkSize);
    const chunkJoins = await Promise.all(
      chunk.map((p) =>
        joinQueue({
          apiUrl,
          token: p.token,
          serviceId,
        }).then((res) => {
          p.tokenId = res.token._id || res.token.id;
          p.tokenNumber = res.token.number;
          return res.token;
        })
      )
    );
    tokens.push(...chunkJoins);
  }

  // Determine expected peopleAhead based on sorted token number order
  tokens.sort((a, b) => a.number - b.number);
  const tokenOrderMap = new Map();
  tokens.forEach((t, idx) => {
    tokenOrderMap.set(String(t._id || t.id), idx);
  });

  patients.forEach((p) => {
    p.expectedPeopleAhead = tokenOrderMap.get(String(p.tokenId)) ?? 0;
  });

  log(`All ${patientCount} patients in queue. Simulating network partition / socket drop storm...`);

  // 5. Drop all sockets simultaneously
  const dropStartTime = Date.now();
  for (const p of patients) {
    try {
      p.socket.disconnect();
    } catch (_) {}
  }

  // 6. Simultaneously reconnect and refetch state via REST
  log('Triggering reconnect storm and REST refetch for all sockets...');
  const recoveryLatencies = [];
  let reconnectErrors = 0;
  let peopleAheadMismatches = 0;

  const recoveryPromises = patients.map(async (p) => {
    const pStart = Date.now();
    try {
      // Reconnect WebSocket
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Socket reconnect timeout'));
        }, 12000);

        p.socket.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });
        p.socket.once('connect_error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        p.socket.connect();
      });

      // Refetch state via REST
      const refetched = await apiRequest(`${apiUrl}/api/tokens/${p.tokenId}`, {
        token: p.token,
      });

      const recoveredPeopleAhead = refetched.peopleAhead;
      if (recoveredPeopleAhead !== p.expectedPeopleAhead) {
        peopleAheadMismatches++;
      }

      const pLatency = Date.now() - dropStartTime;
      recoveryLatencies.push(pLatency);
      return { success: true, latency: pLatency };
    } catch (err) {
      reconnectErrors++;
      return { success: false, error: err.message };
    }
  });

  const recoveryResults = await Promise.all(recoveryPromises);
  const dropEndTime = Date.now();
  const totalStormDurationMs = Math.max(1, dropEndTime - dropStartTime);

  const reconnectedCount = recoveryResults.filter((r) => r.success).length;
  const strandedCount = patientCount - reconnectedCount;
  const percentiles = calculatePercentiles(recoveryLatencies);

  // 7. Cleanup sockets
  for (const p of patients) {
    try {
      p.socket.disconnect();
    } catch (_) {}
  }

  const scenarioResult = {
    scenario: 'reconnect',
    patientCount,
    totalCount: patientCount,
    reconnectedCount,
    strandedCount,
    peopleAheadMismatches,
    errors: reconnectErrors,
    durationMs: totalStormDurationMs,
    percentiles,
  };

  const evaluation = evaluateThresholds('reconnect', {
    errors: reconnectErrors,
    totalCount: patientCount,
    reconnectedCount,
    durationMs: totalStormDurationMs,
    strandedCount,
    peopleAheadMismatches,
  });

  return {
    ...scenarioResult,
    passed: evaluation.passed,
    failures: evaluation.failures,
  };
}

module.exports = { runReconnectScenario };
