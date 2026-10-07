import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/**
 * Route guard component:
 * 1. Unauthenticated users are redirected to /login
 * 2. Authenticated users with invalid role for this route are redirected to their home screen
 */
export function ProtectedRoute({ allowedRoles, children }) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    if (user?.role === 'patient') {
      return <Navigate to="/patient" replace />;
    }
    if (user?.role === 'staff' || user?.role === 'admin') {
      return <Navigate to="/staff" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return children ? children : <Outlet />;
}
