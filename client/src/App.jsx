import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { SocketProvider } from './realtime/SocketProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { PatientHome } from './pages/PatientHome';
import { StaffDashboard } from './pages/StaffDashboard';

function RouteFallback() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'staff' || user?.role === 'admin') {
    return <Navigate to="/staff" replace />;
  }

  return <Navigate to="/patient" replace />;
}

export function App() {
  return (
    <SocketProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Patient Route */}
        <Route element={<ProtectedRoute allowedRoles={['patient']} />}>
          <Route path="/patient" element={<PatientHome />} />
        </Route>

        {/* Staff Route */}
        <Route element={<ProtectedRoute allowedRoles={['staff', 'admin']} />}>
          <Route path="/staff" element={<StaffDashboard />} />
        </Route>

        {/* Default and unknown routes */}
        <Route path="/" element={<RouteFallback />} />
        <Route path="*" element={<RouteFallback />} />
      </Routes>
    </SocketProvider>
  );
}

export default App;
