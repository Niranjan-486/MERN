/**
 * SmartQueue HTTP API Benchmark with k6
 *
 * Covers the core patient loop:
 *   1. Verify OTP Login (with simulator key bypass for auth limiter)
 *   2. List Active Services
 *   3. Join Queue (POST /api/services/:id/tokens)
 *   4. Poll Token Status & ETA (GET /api/tokens/:id)
 *
 * Usage:
 *   1. Local k6:
 *      k6 run -e TARGET_URL=http://localhost:10000 -e SIMULATOR_KEY=smartqueue-bench-simulator-key-2026-safe bench/k6-http.js
 *
 *   2. Docker (works on Windows / macOS / Linux):
 *      docker run --rm -i --net="host" -e TARGET_URL=http://localhost:10000 -e SIMULATOR_KEY=smartqueue-bench-simulator-key-2026-safe grafana/k6 run - < bench/k6-http.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:10000';
const SIMULATOR_KEY = __ENV.SIMULATOR_KEY || 'smartqueue-bench-simulator-key-2026-safe';
const OTP_CODE = __ENV.OTP_CODE || '123456';

export const options = {
  scenarios: {
    ramping_patient_traffic: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 20, duration: '15s' }, // Ramp up to 20 joins/s
        { target: 50, duration: '30s' }, // Sustained load at 50 joins/s
        { target: 0, duration: '10s' },  // Ramp down
      ],
    },
  },
  thresholds: {
    // Correctness: error rate under 1%
    http_req_failed: ['rate<0.01'],
    // Performance: join p95 latency under 500ms
    'http_req_duration{name:join_queue}': ['p(95)<500'],
  },
};

export default function () {
  // Generate unique fake phone number per VU and iteration
  const phoneSuffix = String((__VU * 10000 + __ITER) % 900000000 + 100000000);
  const phone = `0${phoneSuffix}`;

  const defaultHeaders = {
    'Content-Type': 'application/json',
    'x-simulator-key': SIMULATOR_KEY,
  };

  // 1. Verify OTP Login
  const loginRes = http.post(
    `${TARGET_URL}/api/auth/verify-otp`,
    JSON.stringify({
      phone,
      otp: OTP_CODE,
      name: `K6 Patient ${phoneSuffix}`,
    }),
    { headers: defaultHeaders, tags: { name: 'verify_otp' } }
  );

  const loginOk = check(loginRes, {
    'login status is 200': (r) => r.status === 200,
    'login has token': (r) => !!r.json('token'),
  });

  if (!loginOk) return;

  const authToken = loginRes.json('token');
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
    'x-simulator-key': SIMULATOR_KEY,
  };

  // 2. List Active Services
  const servicesRes = http.get(`${TARGET_URL}/api/services`, {
    headers: authHeaders,
    tags: { name: 'list_services' },
  });

  const servicesOk = check(servicesRes, {
    'services status is 200': (r) => r.status === 200,
    'at least one service available': (r) => (r.json() || []).length > 0,
  });

  if (!servicesOk) return;

  const services = servicesRes.json();
  const activeService = services.find((s) => s.isActive) || services[0];
  const serviceId = activeService.id || activeService._id;

  // 3. Join Queue
  const joinRes = http.post(
    `${TARGET_URL}/api/services/${serviceId}/tokens`,
    JSON.stringify({}),
    { headers: authHeaders, tags: { name: 'join_queue' } }
  );

  const joinOk = check(joinRes, {
    'join status is 201': (r) => r.status === 201,
    'token number assigned': (r) => typeof r.json('token.number') === 'number',
  });

  if (!joinOk) return;

  const tokenId = joinRes.json('token._id') || joinRes.json('token.id');

  // 4. Poll Token Status
  const tokenRes = http.get(`${TARGET_URL}/api/tokens/${tokenId}`, {
    headers: authHeaders,
    tags: { name: 'get_token_status' },
  });

  check(tokenRes, {
    'token status is 200': (r) => r.status === 200,
    'peopleAhead is non-negative': (r) => typeof r.json('peopleAhead') === 'number' && r.json('peopleAhead') >= 0,
  });

  sleep(0.5);
}
