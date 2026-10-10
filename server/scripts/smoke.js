#!/usr/bin/env node

/**
 * SmartQueue Production Smoke Test
 * Usage: npm run smoke -- <apiUrl>
 * Example: npm run smoke -- https://smartqueue-api-firstmern.onrender.com
 */

const path = require('path');
const dotenv = require('dotenv');

// Load env from server/.env if available
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { io } = require('socket.io-client');

const rawApiUrl = process.argv[2] || process.env.API_URL || 'http://localhost:10000';
const apiUrl = rawApiUrl.replace(/\/+$/, '');

const STAFF_PHONE = process.env.STAFF_PHONE || '9999900000';
const STAFF_CODE = process.env.STAFF_CODE || process.env.STAFF_OTP_CODE || 'staffsecret123';
const PATIENT_CODE = process.env.PATIENT_CODE || process.env.OTP_CODE || '123456';

const HEALTH_TIMEOUT_MS = 90 * 1000;
const HEALTH_POLL_INTERVAL_MS = 5 * 1000;
const SOCKET_TIMEOUT_MS = 15 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log('====================================================');
  console.log(`SMARTQUEUE SMOKE TEST`);
  console.log(`Target API URL: ${apiUrl}`);
  console.log('====================================================\n');

  let patientToken = null;
  let staffToken = null;
  let createdTokenId = null;
  let socket = null;

  try {
    // ------------------------------------------------------------------
    // Step 1: Health & Readiness Check
    // ------------------------------------------------------------------
    console.log('[Step 1] Checking service health & database readiness...');
    const startTime = Date.now();
    let healthOk = false;

    while (Date.now() - startTime < HEALTH_TIMEOUT_MS) {
      try {
        const healthRes = await requestJson(`${apiUrl}/health`);
        if (healthRes.ok && healthRes.data?.status === 'ok') {
          healthOk = true;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`  [PASS] GET /health responded with status 200 in ${elapsed}s`);
          break;
        }
      } catch (err) {
        // Ignored during cold-start polling
      }
      console.log(`  Waiting for /health (polling every 5s, cold-start retry)...`);
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }

    if (!healthOk) {
      console.error(`  [FAIL] GET /health failed to respond within ${HEALTH_TIMEOUT_MS / 1000}s`);
      process.exit(1);
    }

    // Check readiness (database and redis connectivity)
    try {
      const readyRes = await requestJson(`${apiUrl}/ready`);
      if (!readyRes.ok || readyRes.data?.mongo !== 'connected') {
        console.error(`  [FAIL] GET /ready reported database not ready:`, readyRes.data);
        process.exit(1);
      }
      if (readyRes.data?.redis !== 'up') {
        console.error(`  [FAIL] GET /ready reported Redis not up:`, readyRes.data);
        process.exit(1);
      }
      console.log('  [PASS] GET /ready confirmed MongoDB connection is active and Redis is up');
    } catch (err) {
      console.error(`  [FAIL] GET /ready request error:`, err.message);
      process.exit(1);
    }

    // ------------------------------------------------------------------
    // Step 2: Authentication & Service Selection
    // ------------------------------------------------------------------
    console.log('\n[Step 2] Authenticating throwaway patient and staff user...');

    // Throwaway patient login (random 10-digit phone starting with 98)
    const randomDigits = Math.floor(10000000 + Math.random() * 90000000);
    const patientPhone = `98${randomDigits}`;

    const patientAuth = await requestJson(`${apiUrl}/api/auth/verify-otp`, {
      method: 'POST',
      body: JSON.stringify({
        phone: patientPhone,
        otp: PATIENT_CODE,
        name: 'Smoke Test',
      }),
    });

    if (!patientAuth.ok || !patientAuth.data?.token) {
      console.error('  [FAIL] Patient login failed:', patientAuth.data);
      process.exit(1);
    }
    patientToken = patientAuth.data.token;
    console.log(`  [PASS] Patient logged in: ${patientPhone} (ID: ${patientAuth.data.user?.id})`);

    // Staff login
    const staffAuth = await requestJson(`${apiUrl}/api/auth/verify-otp`, {
      method: 'POST',
      body: JSON.stringify({
        phone: STAFF_PHONE,
        otp: STAFF_CODE,
      }),
    });

    if (!staffAuth.ok || !staffAuth.data?.token) {
      console.error('  [FAIL] Staff login failed:', staffAuth.data);
      process.exit(1);
    }
    staffToken = staffAuth.data.token;
    console.log(`  [PASS] Staff logged in: ${STAFF_PHONE} (ID: ${staffAuth.data.user?.id})`);

    // List services and pick the first
    const servicesRes = await requestJson(`${apiUrl}/api/services`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });

    if (!servicesRes.ok || !Array.isArray(servicesRes.data) || servicesRes.data.length === 0) {
      console.error('  [FAIL] Unable to list services:', servicesRes.data);
      process.exit(1);
    }

    const service = servicesRes.data[0];
    console.log(`  [PASS] Selected service: "${service.name}" (${service.id})`);

    // ------------------------------------------------------------------
    // Step 3: Check Waiting Count (Safety Guard)
    // ------------------------------------------------------------------
    console.log('\n[Step 3] Checking queue waiting count for patient safety...');
    if (service.waitingCount > 0) {
      console.log(
        `  [SKIPPED] Queue for service "${service.name}" is not empty (waitingCount: ${service.waitingCount}).`
      );
      console.log('  Skipping staff call/serve steps so no real patient is accidentally called.');
      console.log('\n====================================================');
      console.log('SMOKE TEST RESULT: SKIPPED (Queue not empty)');
      console.log('====================================================');
      process.exit(0);
    }
    console.log(`  [PASS] Queue is empty (waitingCount: 0). Safe to proceed with consultation cycle.`);

    // ------------------------------------------------------------------
    // Step 4: Token Lifecycle & Socket.io Verification
    // ------------------------------------------------------------------
    console.log('\n[Step 4] Connecting patient Socket.io client and verifying transitions...');

    const receivedStatuses = [];
    let resolveEvents;
    const allEventsPromise = new Promise((resolve) => {
      resolveEvents = resolve;
    });

    socket = io(apiUrl, {
      auth: { token: patientToken },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 10000,
    });

    await new Promise((resolve, reject) => {
      const connTimeout = setTimeout(() => {
        reject(new Error('Socket connection timed out after 10s'));
      }, 10000);

      socket.on('connect', () => {
        clearTimeout(connTimeout);
        console.log(`  [PASS] Patient Socket.io connected (socket id: ${socket.id})`);
        resolve();
      });

      socket.on('connect_error', (err) => {
        clearTimeout(connTimeout);
        reject(new Error(`Socket connection error: ${err.message}`));
      });
    });

    let resolveNearNotif;
    const nearNotifPromise = new Promise((resolve) => {
      resolveNearNotif = resolve;
    });

    let resolveCalledNotif;
    const calledNotifPromise = new Promise((resolve) => {
      resolveCalledNotif = resolve;
    });

    socket.on('notification:new', (evt) => {
      console.log(`  [Socket Event] notification:new -> kind: "${evt.kind}", title: "${evt.title}"`);
      if (evt.kind === 'near') {
        resolveNearNotif(true);
      } else if (evt.kind === 'called') {
        resolveCalledNotif(true);
      }
    });

    // Patient joins queue
    const joinRes = await requestJson(`${apiUrl}/api/services/${service.id}/tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({}),
    });

    if (!joinRes.ok || !joinRes.data?.token) {
      console.error('  [FAIL] Failed to join queue:', joinRes.data);
      process.exit(1);
    }

    const tokenDoc = joinRes.data.token;
    createdTokenId = tokenDoc._id || tokenDoc.id;
    console.log(`  [PASS] Patient joined queue: Token #${tokenDoc.number} (ID: ${createdTokenId})`);

    // Wait for "near" notification
    console.log('  Waiting up to 10s for patient "near" notification:new event...');
    const nearTimeout = setTimeout(() => resolveNearNotif(false), 10000);
    const gotNear = await nearNotifPromise;
    clearTimeout(nearTimeout);

    if (!gotNear) {
      console.error('  [FAIL] Did not receive "near" notification:new event');
      process.exit(1);
    }
    console.log('  [PASS] Patient Socket.io received "near" notification:new');

    // Attach listener for this token
    socket.on('token:updated', (evt) => {
      if (String(evt.tokenId) === String(createdTokenId)) {
        console.log(`  [Socket Event] token:updated -> status: "${evt.status}"`);
        receivedStatuses.push(evt.status);
        if (
          receivedStatuses.includes('called') &&
          receivedStatuses.includes('serving') &&
          receivedStatuses.includes('completed')
        ) {
          resolveEvents(true);
        }
      }
    });

    // Staff lists counters
    const countersRes = await requestJson(`${apiUrl}/api/counters`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });

    if (!countersRes.ok || !Array.isArray(countersRes.data) || countersRes.data.length === 0) {
      console.error('  [FAIL] Failed to list counters for staff:', countersRes.data);
      process.exit(1);
    }

    const counter =
      countersRes.data.find((c) => String(c.serviceId) === String(service.id)) ||
      countersRes.data[0];

    console.log(`  [PASS] Staff selected counter: "${counter.name}" (${counter.id})`);

    // Staff calls next
    const callRes = await requestJson(`${apiUrl}/api/counters/${counter.id}/call-next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({}),
    });

    if (!callRes.ok || !callRes.data?.token) {
      console.error('  [FAIL] Staff call-next failed:', callRes.data);
      process.exit(1);
    }
    console.log(`  [PASS] Staff called next token: #${callRes.data.token.number} (Status: CALLED)`);

    // Wait for "called" notification
    console.log('  Waiting up to 10s for patient "called" notification:new event...');
    const calledTimeout = setTimeout(() => resolveCalledNotif(false), 10000);
    const gotCalled = await calledNotifPromise;
    clearTimeout(calledTimeout);

    if (!gotCalled) {
      console.error('  [FAIL] Did not receive "called" notification:new event');
      process.exit(1);
    }
    console.log('  [PASS] Patient Socket.io received "called" notification:new');

    // Staff starts consultation
    const startRes = await requestJson(`${apiUrl}/api/tokens/${createdTokenId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ counterId: counter.id }),
    });

    if (!startRes.ok) {
      console.error('  [FAIL] Staff start serving failed:', startRes.data);
      process.exit(1);
    }
    console.log(`  [PASS] Staff started consultation (Status: SERVING)`);

    // Staff completes consultation
    const completeRes = await requestJson(`${apiUrl}/api/tokens/${createdTokenId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ counterId: counter.id }),
    });

    if (!completeRes.ok) {
      console.error('  [FAIL] Staff complete consultation failed:', completeRes.data);
      process.exit(1);
    }
    console.log(`  [PASS] Staff completed consultation (Status: COMPLETED)`);

    // Wait for all 3 socket events
    console.log('  Waiting up to 15s for patient socket events: called, serving, completed...');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Socket events timeout after ${SOCKET_TIMEOUT_MS / 1000}s. Received: [${receivedStatuses.join(
                ', '
              )}]`
            )
          ),
        SOCKET_TIMEOUT_MS
      )
    );

    await Promise.race([allEventsPromise, timeoutPromise]);
    console.log('  [PASS] Patient Socket.io verified all state transitions: called -> serving -> completed');

    console.log('\n====================================================');
    console.log('SMOKE TEST RESULT: ALL TESTS PASSED');
    console.log('====================================================\n');
  } catch (err) {
    console.error(`\n[FAIL] Smoke test encountered an error:`, err.message);

    // Clean up active token if incomplete
    if (createdTokenId && patientToken) {
      try {
        console.log(`  Attempting to cancel incomplete token ${createdTokenId}...`);
        await requestJson(`${apiUrl}/api/tokens/${createdTokenId}/cancel`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${patientToken}` },
          body: JSON.stringify({}),
        });
        console.log(`  Cancelled incomplete token ${createdTokenId}`);
      } catch (_) {
        // Ignore cleanup failure
      }
    }

    process.exit(1);
  } finally {
    if (socket) {
      socket.disconnect();
    }
  }
}

main();
