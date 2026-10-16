const path = require('path');
module.paths.push(path.resolve(__dirname, '../../server/node_modules'));

const {
  loginUser,
  getServices,
  getCounters,
  joinQueue,
  callNext,
  startServing,
  completeToken,
  connectSocket,
  apiRequest,
} = require('../../server/tools/sim/simClient');
const { calculatePercentiles } = require('../../server/tools/sim/percentile');
const { evaluateThresholds } = require('../thresholds');

/**
 * Runs the accelerated flow scenario (staff serving patients through complete lifecycle).
 */
async function runFlowScenario({
  apiUrl,
  simulatorKey,
  patientCount = 300,
  patientCode = '123456',
  staffPhone = '9999900000',
  staffCode = 'staffsecret123',
  onProgress,
}) {
  const log = (msg) => {
    if (typeof onProgress === 'function') onProgress(msg);
  };

  log(`Preparing flow scenario with N=${patientCount} patients...`);

  // 1. Authenticate staff
  log('Authenticating staff session...');
  const staffLogin = await loginUser({
    apiUrl,
    phone: staffPhone,
    otp: staffCode,
    name: 'Staff Operator',
    simulatorKey,
  });
  const staffToken = staffLogin.token;

  // 2. Discover service & active counter
  const services = await getServices({ apiUrl, token: staffToken });
  const service = services.find((s) => s.isActive) || services[0];
  if (!service) {
    throw new Error('No active service found for flow scenario');
  }
  const serviceId = service.id || service._id;

  const counters = await getCounters({ apiUrl, token: staffToken });
  const activeCounter = counters.find((c) => c.status === 'active') || counters[0];
  if (!activeCounter) {
    throw new Error('No active counter found for flow scenario');
  }
  const counterId = activeCounter.id || activeCounter._id;

  log(`Using service "${service.name}" (${serviceId}) and counter "${activeCounter.name}" (${counterId})`);

  // 3. Login patients and connect sockets
  log(`Logging in ${patientCount} patients and connecting sockets...`);
  const patients = [];
  const sockets = [];
  const patientState = new Map(); // tokenId -> { calledAt, notifAt }
  const userToTokenMap = new Map(); // userId -> tokenId

  const chunkSize = 25;
  for (let i = 1; i <= patientCount; i += chunkSize) {
    const chunkPromises = [];
    for (let j = i; j < i + chunkSize && j <= patientCount; j++) {
      const phone = String(j + 1000).padStart(10, '0');
      const name = `Flow Patient ${j}`;
      chunkPromises.push(
        loginUser({
          apiUrl,
          phone,
          otp: patientCode,
          name,
          simulatorKey,
        }).then(async (res) => {
          const userId = res.user.id || res.user._id;
          const socket = await connectSocket({ apiUrl, token: res.token, timeoutMs: 15000 });
          socket.on('token:updated', (evt) => {
            if (evt.status === 'called') {
              const state = patientState.get(evt.tokenId) || {};
              state.calledReceivedAt = Date.now();
              patientState.set(evt.tokenId, state);
            }
          });
          socket.on('notification:new', (evt) => {
            if (evt.kind === 'called') {
              const tid = String(evt.tokenId);
              const state = patientState.get(tid) || {};
              state.notifReceivedAt = Date.now();
              patientState.set(tid, state);
            }
          });
          sockets.push(socket);
          return {
            index: j,
            userId,
            token: res.token,
          };
        })
      );
    }
    const chunkResults = await Promise.all(chunkPromises);
    patients.push(...chunkResults);
  }

  // 4. Patients join the queue
  log(`Enqueuing ${patientCount} patients...`);
  const joinedTokens = [];
  for (let i = 0; i < patients.length; i += chunkSize) {
    const chunk = patients.slice(i, i + chunkSize);
    const chunkJoins = await Promise.all(
      chunk.map((p) =>
        joinQueue({
          apiUrl,
          token: p.token,
          serviceId,
        }).then((res) => {
          const tid = String(res.token._id || res.token.id);
          userToTokenMap.set(p.userId, tid);
          patientState.set(tid, {
            tokenId: tid,
            userId: p.userId,
            calledTriggeredAt: null,
            calledReceivedAt: null,
            notifReceivedAt: null,
          });
          return res.token;
        })
      )
    );
    joinedTokens.push(...chunkJoins);
  }

  log(`Successfully enqueued ${joinedTokens.length} tokens. Starting accelerated staff serving...`);

  // 5. Staff serving loop (accelerated 100-300ms serving time)
  const flowStartTime = Date.now();
  const callNextToCalledLatencies = [];
  const notificationLatencies = [];
  let servedCount = 0;
  let flowErrors = 0;

  for (let i = 0; i < joinedTokens.length; i++) {
    const callStart = Date.now();
    let calledRes;
    try {
      calledRes = await callNext({ apiUrl, token: staffToken, counterId });
    } catch (err) {
      flowErrors++;
      log(`Error calling next: ${err.message}`);
      break;
    }

    if (!calledRes || !calledRes.token) {
      log('Queue empty before all tokens served');
      break;
    }

    const currentTokenId = String(calledRes.token._id || calledRes.token.id);
    const pState = patientState.get(currentTokenId) || {};
    pState.calledTriggeredAt = callStart;
    patientState.set(currentTokenId, pState);

    // Wait briefly for patient socket to receive 'called' event (up to 1.5s)
    const waitStart = Date.now();
    while (!pState.calledReceivedAt && Date.now() - waitStart < 1500) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const calledReceivedAt = pState.calledReceivedAt || Date.now();
    const callNextLatency = calledReceivedAt - callStart;
    callNextToCalledLatencies.push(callNextLatency);

    // Track notification if already arrived
    if (pState.notifReceivedAt) {
      notificationLatencies.push(pState.notifReceivedAt - callStart);
      pState.recordedNotif = true;
    }

    // Accelerated serving time: 100ms - 300ms
    const serveDuration = Math.floor(Math.random() * 200) + 100;
    await new Promise((r) => setTimeout(r, serveDuration));

    // Start serving
    try {
      await startServing({
        apiUrl,
        token: staffToken,
        tokenId: currentTokenId,
        counterId,
      });

      // Complete token
      await completeToken({
        apiUrl,
        token: staffToken,
        tokenId: currentTokenId,
        counterId,
      });
      servedCount++;
    } catch (err) {
      flowErrors++;
      log(`Error serving token ${currentTokenId}: ${err.message}`);
    }

    if (servedCount % 50 === 0) {
      log(`Served ${servedCount}/${patientCount} tokens...`);
    }
  }

  // Collect any remaining delivered notifications
  for (const [_, state] of patientState.entries()) {
    if (state.calledTriggeredAt && state.notifReceivedAt && !state.recordedNotif) {
      notificationLatencies.push(state.notifReceivedAt - state.calledTriggeredAt);
      state.recordedNotif = true;
    }
  }

  const flowEndTime = Date.now();
  const totalFlowDurationMs = Math.max(1, flowEndTime - flowStartTime);
  const totalMinutes = totalFlowDurationMs / 60000;
  const queueDrainRatePerMin =
    totalMinutes > 0 ? Math.round((servedCount / totalMinutes) * 100) / 100 : 0;

  // 6. Assert zero stuck tokens
  // Check queue snapshot to see if any tokens remain waiting, called, or serving
  const queueSnapshot = await apiRequest(`${apiUrl}/api/services/${serviceId}/queue`, {
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  const stuckCount = (queueSnapshot.waitingCount || 0) + (Array.isArray(queueSnapshot.nowServing) ? queueSnapshot.nowServing.length : 0);

  // 7. Calculate Percentiles
  const callNextPercentiles = calculatePercentiles(callNextToCalledLatencies);
  const notifPercentiles = calculatePercentiles(notificationLatencies);
  const completionRate = patientCount > 0 ? Math.round((servedCount / patientCount) * 100) / 100 : 1.0;

  // 8. Cleanup sockets
  for (const s of sockets) {
    try {
      s.disconnect();
    } catch (_) {}
  }

  const scenarioResult = {
    scenario: 'flow',
    patientCount,
    totalCount: patientCount,
    completedCount: servedCount,
    stuckCount,
    errors: flowErrors,
    durationMs: totalFlowDurationMs,
    queueDrainRatePerMin,
    completionRate,
    callNextToCalledPercentiles: callNextPercentiles,
    notificationPercentiles: notifPercentiles,
  };

  const evaluation = evaluateThresholds('flow', {
    stuckCount,
    errors: flowErrors,
    callNextToCalledPercentiles: callNextPercentiles,
    completionRate,
  });

  return {
    ...scenarioResult,
    passed: evaluation.passed,
    failures: evaluation.failures,
  };
}

module.exports = { runFlowScenario };
