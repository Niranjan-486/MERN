import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { ProtectedRoute } from '../components/ProtectedRoute';

function TestApp() {
  return (
    <Routes>
      <Route path="/login" element={<div>Login Screen</div>} />
      <Route element={<ProtectedRoute allowedRoles={['patient']} />}>
        <Route path="/patient" element={<div>Patient Screen</div>} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={['staff', 'admin']} />}>
        <Route path="/staff" element={<div>Staff Screen</div>} />
      </Route>
    </Routes>
  );
}

describe('Route guards', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('patient is redirected away from /staff to /patient', () => {
    localStorage.setItem('token', 'mock-patient-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'u1', name: 'Patient A', role: 'patient' })
    );

    render(
      <MemoryRouter initialEntries={['/staff']}>
        <AuthProvider>
          <TestApp />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Patient Screen')).toBeInTheDocument();
    expect(screen.queryByText('Staff Screen')).not.toBeInTheDocument();
  });

  test('staff is redirected away from /patient to /staff', () => {
    localStorage.setItem('token', 'mock-staff-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'u2', name: 'Dr. Sharma', role: 'staff' })
    );

    render(
      <MemoryRouter initialEntries={['/patient']}>
        <AuthProvider>
          <TestApp />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Staff Screen')).toBeInTheDocument();
    expect(screen.queryByText('Patient Screen')).not.toBeInTheDocument();
  });

  test('unauthenticated user is redirected away from /patient and /staff to /login', () => {
    render(
      <MemoryRouter initialEntries={['/patient']}>
        <AuthProvider>
          <TestApp />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.queryByText('Patient Screen')).not.toBeInTheDocument();
  });
});
