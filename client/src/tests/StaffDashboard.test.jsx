import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StaffDashboard } from '../pages/StaffDashboard';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-staff', name: 'Dr. Sharma', role: 'staff' },
    logout: vi.fn(),
  }),
}));

vi.mock('../realtime/SocketProvider', () => ({
  useSocket: () => ({
    connectionStatus: 'live',
    subscribe: () => () => {},
  }),
}));

const mockDashboardC1 = {
  counter: { id: 'c1', name: 'Counter 1', status: 'active', serviceId: 's1' },
  service: { id: 's1', name: 'General OPD', avgServiceSec: 300 },
  current: null,
  waitingCount: 0,
  waiting: [],
  nowServing: [],
};

describe('StaffDashboard counter selection & picker behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('one active counter -> no picker and opens dashboard directly', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/api/counters') {
        return [
          {
            id: 'c1',
            name: 'Counter 1',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
        ];
      }
      if (url === '/api/counters/c1/dashboard') {
        return mockDashboardC1;
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<StaffDashboard />);

    // Counter 1 dashboard should render directly
    expect(await screen.findByRole('heading', { level: 1, name: 'Counter 1' })).toBeInTheDocument();

    // The counter picker select must NOT be in the document
    expect(screen.queryByLabelText(/^desk:?$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    // LocalStorage has the single active counter saved
    expect(localStorage.getItem('selectedCounterId')).toBe('c1');
  });

  test('two active counters -> displays picker', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/api/counters') {
        return [
          {
            id: 'c1',
            name: 'Counter 1',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
          {
            id: 'c2',
            name: 'Counter 2',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
        ];
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<StaffDashboard />);

    // Picker must be displayed when 2 counters exist
    expect(await screen.findByLabelText(/^desk:?$/i)).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    expect(screen.getByRole('option', { name: /Counter 1/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Counter 2/i })).toBeInTheDocument();
  });

  test('an offline counter is hidden from picker', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/api/counters') {
        return [
          {
            id: 'c1',
            name: 'Counter 1',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
          {
            id: 'c2',
            name: 'Counter 2',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
          {
            id: 'c3',
            name: 'Counter 3',
            status: 'offline',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
        ];
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<StaffDashboard />);

    // Picker shown for the 2 active counters
    expect(await screen.findByLabelText(/^desk:?$/i)).toBeInTheDocument();

    expect(screen.getByRole('option', { name: /Counter 1/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Counter 2/i })).toBeInTheDocument();
    // Offline counter must be hidden
    expect(screen.queryByRole('option', { name: /Counter 3/i })).not.toBeInTheDocument();
  });

  test('clears remembered counter id from localStorage if no longer in the list', async () => {
    localStorage.setItem('selectedCounterId', 'c-stale');

    api.get.mockImplementation(async (url) => {
      if (url === '/api/counters') {
        return [
          {
            id: 'c1',
            name: 'Counter 1',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
          {
            id: 'c2',
            name: 'Counter 2',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
        ];
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<StaffDashboard />);

    await waitFor(() => {
      expect(localStorage.getItem('selectedCounterId')).toBeNull();
    });

    expect(await screen.findByLabelText(/^desk:?$/i)).toBeInTheDocument();
  });

  test('one active counter with an offline counter -> ignores offline counter, no picker, opens dashboard directly', async () => {
    localStorage.setItem('selectedCounterId', 'c2'); // was pointing to c2 before it went offline

    api.get.mockImplementation(async (url) => {
      if (url === '/api/counters') {
        return [
          {
            id: 'c1',
            name: 'Counter 1',
            status: 'active',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
          {
            id: 'c2',
            name: 'Counter 2',
            status: 'offline',
            serviceId: 's1',
            serviceName: 'General OPD',
          },
        ];
      }
      if (url === '/api/counters/c1/dashboard') {
        return mockDashboardC1;
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<StaffDashboard />);

    // Counter 1 dashboard renders directly
    expect(await screen.findByRole('heading', { level: 1, name: 'Counter 1' })).toBeInTheDocument();

    // No picker since only 1 non-offline counter remains
    expect(screen.queryByLabelText(/^desk:?$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    // Stale offline c2 is replaced by c1 in localStorage
    expect(localStorage.getItem('selectedCounterId')).toBe('c1');
  });
});
