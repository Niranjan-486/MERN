import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { QrJoin } from '../pages/QrJoin';
import { Login } from '../pages/Login';
import { StaffDashboard } from '../pages/StaffDashboard';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../realtime/SocketProvider', () => ({
  useSocket: () => ({
    connectionStatus: 'live',
    subscribe: () => () => {},
  }),
}));

describe('QR Join Flow and Security', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  test('unauthenticated user is redirected to /login with returnTo in sessionStorage', async () => {
    render(
      <MemoryRouter initialEntries={['/join/svc-456']}>
        <AuthProvider>
          <Routes>
            <Route path="/join/:serviceId" element={<QrJoin />} />
            <Route path="/login" element={<div>Login Screen</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Login Screen')).toBeInTheDocument();
    expect(sessionStorage.getItem('returnTo')).toBe('/join/svc-456');
  });

  test('Login accepts only safe same-origin returnTo paths and rejects open redirects', async () => {
    api.post.mockResolvedValue({
      token: 'mock-patient-token',
      user: { id: 'p1', name: 'Patient 1', role: 'patient' },
    });

    // Subtest A: Safe path works
    sessionStorage.setItem('returnTo', '/join/svc-123');

    const { unmount } = render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/join/svc-123" element={<div>Target QR Join Screen</div>} />
            <Route path="/patient" element={<div>Default Patient Screen</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Request code
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: '9999900001' } });
    fireEvent.click(screen.getByRole('button', { name: /request (otp|code)/i }));

    // Verify code
    await screen.findByLabelText(/verification code/i);
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify otp and sign in/i }));

    expect(await screen.findByText('Target QR Join Screen')).toBeInTheDocument();
    expect(sessionStorage.getItem('returnTo')).toBeNull();
    unmount();

    // Subtest B: Malicious protocol/scheme or protocol-relative paths are rejected
    for (const evilPath of ['//evil.com', 'https://attacker.com', 'javascript:alert(1)', '\\\\evil.com']) {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('returnTo', evilPath);

      const res = render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/patient" element={<div>Safe Patient Screen</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: '9999900001' } });
      fireEvent.click(screen.getByRole('button', { name: /request (otp|code)/i }));

      await screen.findByLabelText(/verification code/i);
      fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /verify otp and sign in/i }));

      expect(await screen.findByText('Safe Patient Screen')).toBeInTheDocument();
      res.unmount();
    }
  });

  test('authenticated patient sees confirmation screen without auto-joining', async () => {
    localStorage.setItem('token', 'mock-patient-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'p1', name: 'Patient 1', role: 'patient' })
    );

    api.get.mockImplementation(async (url) => {
      if (url === '/api/me/tokens/active') {
        return []; // No existing active tokens
      }
      if (url === '/api/services') {
        return [
          {
            id: 'svc-100',
            name: 'Cardiology OPD',
            organizationName: 'City General Hospital',
            waitingCount: 7,
          },
        ];
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/join/svc-100']}>
        <AuthProvider>
          <Routes>
            <Route path="/join/:serviceId" element={<QrJoin />} />
            <Route path="/patient" element={<div>Patient Home</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify service details are rendered
    expect(await screen.findByText('Cardiology OPD')).toBeInTheDocument();
    expect(screen.getByText('City General Hospital')).toBeInTheDocument();
    expect(screen.getByText(/7 patients currently waiting/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join queue for cardiology opd/i })).toBeInTheDocument();

    // Verify NO auto-join on page load: api.post has NOT been called
    expect(api.post).not.toHaveBeenCalled();

    // User taps Join Queue
    api.post.mockResolvedValueOnce({
      token: { _id: 'tok-new', serviceId: 'svc-100', number: 8, status: 'waiting' },
    });

    fireEvent.click(screen.getByRole('button', { name: /join queue for cardiology opd/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/services/svc-100/tokens', {});
      expect(screen.getByText('Patient Home')).toBeInTheDocument();
    });
  });

  test('patient with existing active token for service redirects directly to /patient', async () => {
    localStorage.setItem('token', 'mock-patient-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'p1', name: 'Patient 1', role: 'patient' })
    );

    api.get.mockImplementation(async (url) => {
      if (url === '/api/me/tokens/active') {
        return [
          {
            tokenId: 'tok-existing',
            serviceId: 'svc-100',
            number: 3,
            status: 'waiting',
          },
        ];
      }
      if (url === '/api/services') {
        return [{ id: 'svc-100', name: 'Cardiology OPD', waitingCount: 3 }];
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/join/svc-100']}>
        <AuthProvider>
          <Routes>
            <Route path="/join/:serviceId" element={<QrJoin />} />
            <Route path="/patient" element={<div>Patient Home Existing Token</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Patient Home Existing Token')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('unknown or inactive service shows helpful error and link to services list', async () => {
    localStorage.setItem('token', 'mock-patient-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'p1', name: 'Patient 1', role: 'patient' })
    );

    api.get.mockImplementation(async (url) => {
      if (url === '/api/me/tokens/active') return [];
      if (url === '/api/services') return [{ id: 'svc-active', name: 'General OPD' }];
      throw new Error(`Unexpected GET ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/join/svc-nonexistent']}>
        <AuthProvider>
          <Routes>
            <Route path="/join/:serviceId" element={<QrJoin />} />
            <Route path="/patient" element={<div>Patient Services List</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Service Not Available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view available services/i })).toBeInTheDocument();
  });

  test('staff accounts are informed they cannot join queues', async () => {
    localStorage.setItem('token', 'mock-staff-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'u-staff', name: 'Nurse Joy', role: 'staff' })
    );

    render(
      <MemoryRouter initialEntries={['/join/svc-100']}>
        <AuthProvider>
          <Routes>
            <Route path="/join/:serviceId" element={<QrJoin />} />
            <Route path="/staff" element={<div>Staff Dashboard Screen</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Staff Account')).toBeInTheDocument();
    expect(screen.getByText(/staff and admin accounts cannot join/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to staff dashboard/i })).toBeInTheDocument();
  });
});

describe('Staff Dashboard Show QR Dialog', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('Show QR button opens accessible dialog displaying SVG QR code with target URL and closes on Escape', async () => {
    localStorage.setItem('token', 'mock-staff-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'u-staff', name: 'Dr. Sharma', role: 'staff' })
    );

    api.get.mockImplementation(async (url) => {
      if (url === '/api/counters') {
        return [{ id: 'c1', name: 'Counter 1', status: 'active', serviceId: 's1' }];
      }
      if (url === '/api/counters/c1/dashboard') {
        return {
          counter: { id: 'c1', name: 'Counter 1', status: 'active', serviceId: 's1' },
          service: { id: 's1', name: 'General OPD', avgServiceSec: 300 },
          current: null,
          waitingCount: 0,
          waiting: [],
          nowServing: [],
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/staff']}>
        <AuthProvider>
          <StaffDashboard />
        </AuthProvider>
      </MemoryRouter>
    );

    // Find and click "Show QR" button
    const showQrBtn = await screen.findByRole('button', { name: /show qr code for this service/i });
    expect(showQrBtn).toBeInTheDocument();
    fireEvent.click(showQrBtn);

    // Verify dialog content
    expect(await screen.findByText('Scan to join the queue')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/join/s1`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print queue poster/i })).toBeInTheDocument();

    // Verify SVG QR code rendered
    const qrSvg = document.querySelector('.qr-print-poster svg');
    expect(qrSvg).toBeInTheDocument();

    // Test Escape key closes dialog
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Scan to join the queue')).not.toBeInTheDocument();
    });
  });
});
