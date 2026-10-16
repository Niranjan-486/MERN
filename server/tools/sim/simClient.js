const { io } = require('socket.io-client');

/**
 * HTTP and WebSocket client helpers for simulated users.
 */

async function apiRequest(url, { method = 'GET', token, headers = {}, body, retries = 2 } = {}) {
  const reqHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (token) {
    reqHeaders['Authorization'] = `Bearer ${token}`;
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: reqHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = text;
      }

      if (!res.ok) {
        const error = new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
        error.status = res.status;
        error.code = data?.error?.code || data?.code;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      lastErr = err;
      if (err.message && err.message.includes('fetch failed') && attempt < retries) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function loginUser({ apiUrl, phone, otp, name, simulatorKey }) {
  const headers = {};
  if (simulatorKey) {
    headers['x-simulator-key'] = simulatorKey;
  }

  const payload = { phone, otp };
  if (name) payload.name = name;

  return await apiRequest(`${apiUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers,
    body: payload,
  });
}

async function getServices({ apiUrl, token }) {
  return await apiRequest(`${apiUrl}/api/services`, {
    method: 'GET',
    token,
  });
}

async function getCounters({ apiUrl, token }) {
  return await apiRequest(`${apiUrl}/api/counters`, {
    method: 'GET',
    token,
  });
}

async function joinQueue({ apiUrl, token, serviceId, userId, priority }) {
  const body = {};
  if (userId) body.userId = userId;
  if (priority !== undefined) body.priority = priority;

  return await apiRequest(`${apiUrl}/api/services/${serviceId}/tokens`, {
    method: 'POST',
    token,
    body,
  });
}

async function cancelToken({ apiUrl, token, tokenId }) {
  return await apiRequest(`${apiUrl}/api/tokens/${tokenId}/cancel`, {
    method: 'POST',
    token,
    body: {},
  });
}

async function callNext({ apiUrl, token, counterId }) {
  return await apiRequest(`${apiUrl}/api/counters/${counterId}/call-next`, {
    method: 'POST',
    token,
    body: {},
  });
}

async function startServing({ apiUrl, token, tokenId, counterId }) {
  return await apiRequest(`${apiUrl}/api/tokens/${tokenId}/start`, {
    method: 'POST',
    token,
    body: { counterId },
  });
}

async function completeToken({ apiUrl, token, tokenId, counterId }) {
  return await apiRequest(`${apiUrl}/api/tokens/${tokenId}/complete`, {
    method: 'POST',
    token,
    body: { counterId },
  });
}

function connectSocket({ apiUrl, token, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const socket = io(apiUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

module.exports = {
  apiRequest,
  loginUser,
  getServices,
  getCounters,
  joinQueue,
  cancelToken,
  callNext,
  startServing,
  completeToken,
  connectSocket,
};
