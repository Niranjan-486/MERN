const API_BASE = import.meta.env?.VITE_API_URL || 'http://localhost:3000';

export class ApiError extends Error {
  constructor(code, message, status, details = null) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN_ERROR';
    this.message = message || this.code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Robust fetch wrapper:
 * 1. Attaches Authorization Bearer token from localStorage
 * 2. Parses JSON responses and translates { error: { code, message } } into thrown ApiError
 * 3. On 401: clears session and redirects to /login
 */
export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;

  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      body,
    });
  } catch (netErr) {
    throw new ApiError('NETWORK_ERROR', 'Network connection failed. Please check your internet.', 0);
  }

  if (response.status === 401) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
  } else {
    try {
      data = await response.text();
    } catch (_) {
      data = null;
    }
  }

  if (!response.ok) {
    const errCode = data?.error?.code || `HTTP_${response.status}`;
    const errMessage = data?.error?.message || response.statusText || 'Request failed';
    throw new ApiError(errCode, errMessage, response.status, data?.error);
  }

  return data;
}

export const api = {
  get: (endpoint, options = {}) => apiRequest(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options = {}) => apiRequest(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options = {}) => apiRequest(endpoint, { ...options, method: 'PUT', body }),
  delete: (endpoint, options = {}) => apiRequest(endpoint, { ...options, method: 'DELETE' }),
};
