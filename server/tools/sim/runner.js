const {
  loginUser,
  getServices,
  getCounters,
  joinQueue,
  cancelToken,
  callNext,
  startServing,
  completeToken,
  connectSocket,
} = require('./simClient');
const { calculatePercentiles } = require('./percentile');
const { ConvergenceTracker } = require('./convergence');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a burst test:
 * - Pre-connects all patient sockets
 * - Fires joins simultaneously with Promise.all
 * - Measures latencies (p50, p95, p99)
 * - Verifies token numbers are strictly contiguous with zero duplicates
 * - Measures convergence time
 */
async function runBurst({
  apiUrl,
  patientCount = 20,
  simulatorKey = process.env.SIMULATOR_KEY,
  patientCode = process.env.PATIENT_CODE || process.env.OTP_CODE || '123456',
  timeoutMs = 15000,
  onProgress,
} = {}) {
  const count = Math.min(100, Math.max(1, parseInt(patientCount, 10) || 20));
  const sockets = [];

  const cleanupSockets = () => {
    for (const s of sockets) {
      if (s && s.connected) {
        s.disconnect();
      }
    }
  };

  try {
    if (onProgress) onProgress(`[1/4] Authenticating ${count} simulated patients...`);

    // 1. Log in all simulated patients
    const patients = [];
    const loginPromises = [];
    for (let i = 1; i <= count; i++) {
      const phone = String(i).padStart(10, '0');
      const name = `Sim Patient ${String(i).padStart(3, '0')}`;
      loginPromises.push(
        loginUser({
          apiUrl,
          phone,
          otp: patientCode,
          name,
          simulatorKey,
        }).then((res) => ({
          index: i,
          phone,
          name,
          token: res.token,
          user: res.user,
        }))
      );
    }

    const authedPatients = await Promise.all(loginPromises);
    authedPatients.sort((a, b) => a.index - b.index);

    // 2. Discover active service
    const services = await getServices({ apiUrl, token: authedPatients[0].token });
    const targetService = services.find((s) => s.name === 'General OPD') || services[0];
    if (!targetService) {
      throw new Error('No active service found to run burst against');
    }
    const initialWaitingCount = targetService.waitingCount || 0;

    if (onProgress) onProgress(`[2/4] Pre-connecting ${count} WebSockets via websocket transport...`);

    // 3. Pre-connect all sockets
    const socketPromises = authedPatients.map((p) =>
      connectSocket({ apiUrl, token: p.token, timeoutMs })
    );
    const connectedSockets = await Promise.all(socketPromises);
    sockets.push(...connectedSockets);

    // 4. Set up socket listeners for token:updated events
    const receivedEvents = new Map(); // userId -> array of events
    const convergenceTracker = new ConvergenceTracker(
      authedPatients.map((p) => ({ userId: p.user.id }))
    );

    authedPatients.forEach((p, idx) => {
      const s = sockets[idx];
      receivedEvents.set(p.user.id, []);
      s.on('token:updated', (evt) => {
        receivedEvents.get(p.user.id).push({ ...evt, receivedAt: Date.now() });
        convergenceTracker.recordEvent(p.user.id, evt, Date.now());
      });
    });

    if (onProgress) onProgress(`[3/4] Firing simultaneous joins for ${count} patients...`);

    // 5. Fire joins simultaneously with Promise.all and measure latencies
    const burstStartTime = Date.now();
    convergenceTracker.startTime = burstStartTime;

    const joinPromises = authedPatients.map(async (p) => {
      const joinStart = Date.now();
      const res = await joinQueue({
        apiUrl,
        token: p.token,
        serviceId: targetService.id,
      });
      const joinEnd = Date.now();
      return {
        userId: p.user.id,
        patientName: p.name,
        tokenId: res.token?._id || res.token?.id,
        tokenNumber: res.token?.number,
        latencyMs: joinEnd - joinStart,
      };
    });

    const joinResults = await Promise.all(joinPromises);

    // 6. Verify token numbers and contiguity
    const tokenNumbers = joinResults.map((r) => r.tokenNumber);
    const sortedNumbers = [...tokenNumbers].sort((a, b) => a - b);
    const uniqueNumbers = new Set(tokenNumbers);
    const hasDuplicates = uniqueNumbers.size !== tokenNumbers.length;

    let isContiguous = true;
    for (let i = 1; i < sortedNumbers.length; i++) {
      if (sortedNumbers[i] !== sortedNumbers[i - 1] + 1) {
        isContiguous = false;
        break;
      }
    }

    // 7. Configure expected peopleAhead on convergence tracker based on final order
    // Order burst patients by token number
    const sortedResults = [...joinResults].sort((a, b) => a.tokenNumber - b.tokenNumber);
    sortedResults.forEach((res, rank) => {
      const expectedPeopleAhead = initialWaitingCount + rank;
      convergenceTracker.setTokenId(res.userId, res.tokenId);
      convergenceTracker.setExpectedPeopleAhead(res.userId, expectedPeopleAhead);
    });

    if (onProgress) onProgress(`[4/4] Awaiting socket convergence for all ${count} clients...`);

    // 8. Wait for convergence (up to timeoutMs)
    const convergenceDeadline = Date.now() + timeoutMs;
    while (!convergenceTracker.isConverged() && Date.now() < convergenceDeadline) {
      await sleep(50);
    }

    const convergenceStatus = convergenceTracker.getStatus();
    const convergenceTimeMs = convergenceTracker.getConvergenceTime();

    const latencies = joinResults.map((r) => r.latencyMs);
    const percentiles = calculatePercentiles(latencies);

    cleanupSockets();

    return {
      serviceId: targetService.id,
      serviceName: targetService.name,
      patientCount: count,
      tokenNumbers: sortedNumbers,
      minTokenNumber: sortedNumbers[0],
      maxTokenNumber: sortedNumbers[sortedNumbers.length - 1],
      isContiguous,
      hasDuplicates,
      latencies,
      percentiles,
      convergence: {
        isConverged: convergenceStatus.isConverged,
        convergedCount: convergenceStatus.convergedCount,
        total: convergenceStatus.total,
        convergenceTimeMs,
      },
    };
  } catch (err) {
    cleanupSockets();
    throw err;
  }
}

/**
 * Runs a demo simulation:
 * - Spreads arrivals over duration with jitter
 * - Supports cancel-rate, priority-rate, and staff-bot with no-show-rate
 * - Renders a live 1-line status display
 */
async function runDemo({
  apiUrl,
  patientCount = 40,
  duration = 90,
  cancelRate = 0.05,
  priorityRate = 0.1,
  staffBot = false,
  serviceTimeRange = [10, 20],
  noShowRate = 0.05,
  staffPhone = process.env.STAFF_PHONE || '9999900000',
  staffCode = process.env.STAFF_CODE || process.env.STAFF_OTP_CODE || 'staffsecret123',
  patientCode = process.env.PATIENT_CODE || process.env.OTP_CODE || '123456',
  simulatorKey = process.env.SIMULATOR_KEY,
  abortSignal,
} = {}) {
  const count = Math.max(1, parseInt(patientCount, 10) || 40);
  const durationSec = Math.max(5, parseInt(duration, 10) || 90);
  const sockets = [];

  const cleanupSockets = () => {
    for (const s of sockets) {
      if (s && s.connected) {
        s.disconnect();
      }
    }
  };

  try {
    // 1. Staff session login (optional for priority joins and staff bot)
    let staffSession = null;
    try {
      const staffRes = await loginUser({
        apiUrl,
        phone: staffPhone,
        otp: staffCode,
        simulatorKey,
      });
      staffSession = { token: staffRes.token, user: staffRes.user };
    } catch (err) {
      console.warn(`[WARNING] Staff login failed (${err.message}). Priority joins and staff bot disabled.`);
    }

    // 2. Discover service & counters
    let testToken = staffSession?.token;
    if (!testToken) {
      const tempPatient = await loginUser({
        apiUrl,
        phone: '0000000001',
        otp: patientCode,
        name: 'Sim Patient 001',
        simulatorKey,
      });
      testToken = tempPatient.token;
    }

    const services = await getServices({ apiUrl, token: testToken });
    const targetService = services.find((s) => s.name === 'General OPD') || services[0];
    if (!targetService) {
      throw new Error('No active service found to run demo against');
    }

    let activeCounter = null;
    if (staffSession) {
      try {
        const counters = await getCounters({ apiUrl, token: staffSession.token });
        activeCounter = counters.find((c) => c.serviceId === targetService.id && c.status === 'active') || counters[0];
      } catch (_) {}
    }

    // 3. Stats tracking
    const stats = {
      arrived: 0,
      priority: 0,
      cancelled: 0,
      served: 0,
      noShow: 0,
    };

    // 4. Generate arrival schedule with random jitter
    const arrivalDelays = [];
    for (let i = 0; i < count; i++) {
      // Uniform random distribution with jitter across durationSec
      arrivalDelays.push(Math.random() * durationSec);
    }
    arrivalDelays.sort((a, b) => a - b);

    let isRunning = true;
    const startTime = Date.now();

    // 5. Staff Bot Loop (if enabled and staff available)
    if (staffBot && staffSession && activeCounter) {
      (async () => {
        while (isRunning && (!abortSignal || !abortSignal.aborted)) {
          try {
            // Call next
            const callRes = await callNext({
              apiUrl,
              token: staffSession.token,
              counterId: activeCounter.id,
            });

            const calledToken = callRes.token;
            if (calledToken) {
              // Check no-show rate
              if (Math.random() < noShowRate) {
                stats.noShow++;
                // Leave untouched for no-show grace timer
                await sleep(3000);
                continue;
              }

              // Human delay: 1-3 seconds
              await sleep(1000 + Math.random() * 2000);

              if (!isRunning) break;
              // Start serving
              await startServing({
                apiUrl,
                token: staffSession.token,
                tokenId: calledToken._id || calledToken.id,
                counterId: activeCounter.id,
              });

              // Serve for random time in serviceTimeRange
              const minServ = serviceTimeRange[0] * 1000;
              const maxServ = serviceTimeRange[1] * 1000;
              const servTime = minServ + Math.random() * (maxServ - minServ);
              await sleep(servTime);

              if (!isRunning) break;
              // Complete
              await completeToken({
                apiUrl,
                token: staffSession.token,
                tokenId: calledToken._id || calledToken.id,
                counterId: activeCounter.id,
              });
              stats.served++;
            }
          } catch (err) {
            // Gracefully handle QUEUE_EMPTY and COUNTER_BUSY
            if (err.code === 'QUEUE_EMPTY') {
              await sleep(2000);
            } else if (err.code === 'COUNTER_BUSY') {
              await sleep(1000);
            } else {
              await sleep(2000);
            }
          }
        }
      })();
    }

    // 6. Arrival worker
    const arrivalPromises = arrivalDelays.map(async (delaySec, index) => {
      const patientNum = index + 1;
      await sleep(delaySec * 1000);

      if (!isRunning || (abortSignal && abortSignal.aborted)) return;

      const phone = String(patientNum).padStart(10, '0');
      const name = `Sim Patient ${String(patientNum).padStart(3, '0')}`;

      try {
        const patientRes = await loginUser({
          apiUrl,
          phone,
          otp: patientCode,
          name,
          simulatorKey,
        });

        const socket = await connectSocket({ apiUrl, token: patientRes.token });
        sockets.push(socket);

        let isPriority = false;
        let priorityVal = 0;
        if (staffSession && Math.random() < priorityRate) {
          isPriority = true;
          priorityVal = Math.random() < 0.5 ? 1 : 2;
        }

        let joinRes;
        if (isPriority) {
          joinRes = await joinQueue({
            apiUrl,
            token: staffSession.token,
            serviceId: targetService.id,
            userId: patientRes.user.id,
            priority: priorityVal,
          });
          stats.priority++;
        } else {
          joinRes = await joinQueue({
            apiUrl,
            token: patientRes.token,
            serviceId: targetService.id,
          });
        }
        stats.arrived++;

        const tokenDoc = joinRes.token;

        // Check cancel rate
        if (Math.random() < cancelRate) {
          // Cancel after a short delay
          sleep(5000 + Math.random() * 5000).then(async () => {
            try {
              await cancelToken({
                apiUrl,
                token: patientRes.token,
                tokenId: tokenDoc._id || tokenDoc.id,
              });
              stats.cancelled++;
            } catch (_) {}
          });
        }
      } catch (err) {
        // Individual simulated patient arrival failure
      }
    });

    // 7. Status display loop (1 line updated once per second)
    const statusInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      const remainingSec = Math.max(0, durationSec - elapsedSec);

      const formatTime = (s) => {
        const mins = String(Math.floor(s / 60)).padStart(2, '0');
        const secs = String(s % 60).padStart(2, '0');
        return `${mins}:${secs}`;
      };

      const line = `[Demo] ${formatTime(elapsedSec)} / ${formatTime(durationSec)} | Arrived: ${stats.arrived}/${count} | Priority: ${stats.priority} | Cancelled: ${stats.cancelled} | Served: ${stats.served} | No-shows: ${stats.noShow}`;
      process.stdout.write(`\r${line}`);
    }, 1000);

    // Wait for all arrivals or duration to conclude
    await Promise.all(arrivalPromises);
    const remainingTime = Math.max(0, durationSec * 1000 - (Date.now() - startTime));
    if (remainingTime > 0) {
      await sleep(remainingTime);
    }

    isRunning = false;
    clearInterval(statusInterval);
    process.stdout.write('\n[Demo] Completed successfully.\n');
    cleanupSockets();

    return stats;
  } catch (err) {
    cleanupSockets();
    throw err;
  }
}

module.exports = {
  runBurst,
  runDemo,
};
