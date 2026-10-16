import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LazyMotion, MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { useAuth } from './auth/AuthContext';
import { SocketProvider } from './realtime/SocketProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { Skeleton } from './components/ui/Skeleton';

// Route-level code splitting with React.lazy
const Login = lazy(() => import('./pages/Login'));
const PatientHome = lazy(() => import('./pages/PatientHome'));
const StaffDashboard = lazy(() => import('./pages/StaffDashboard'));
const QrJoin = lazy(() => import('./pages/QrJoin'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Lazy load DevStates only in DEV
const DevStates = import.meta.env.DEV
  ? lazy(() => import('./pages/DevStates'))
  : null;

// Dynamic motion feature loading: domMax on staff route for layout animations, domAnimation elsewhere
const loadMotionFeatures = () =>
  window.location.pathname.startsWith('/staff')
    ? import('motion/react').then((res) => res.domMax)
    : import('motion/react').then((res) => res.domAnimation);

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

function PageFallback() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="h-10 w-32 rounded-[var(--radius-control)]" />
        <Skeleton className="h-48 w-full rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <OfflineBanner />
      <Toaster richColors position="top-right" />
      <LazyMotion features={loadMotionFeatures}>
        <MotionConfig reducedMotion="user">
          <SocketProvider>
            <Suspense fallback={<PageFallback />}>
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

                {/* QR Code Join Route */}
                <Route path="/join/:serviceId" element={<QrJoin />} />

                {/* Dev States fixture gallery (DEV only) */}
                {import.meta.env.DEV && DevStates && (
                  <Route path="/dev/states" element={<DevStates />} />
                )}

                {/* Default root fallback */}
                <Route path="/" element={<RouteFallback />} />

                {/* Friendly 404 page for unknown routes */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </SocketProvider>
        </MotionConfig>
      </LazyMotion>
    </ErrorBoundary>
  );
}

export default App;
