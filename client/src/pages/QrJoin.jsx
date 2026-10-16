import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Users, AlertCircle, ArrowLeft, ShieldAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { getFriendlyErrorMessage } from '../lib/errors';
import { TopBar } from '../components/ui/TopBar';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';

export function QrJoin() {
  const { serviceId } = useParams();
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [service, setService] = useState(null);
  const [isUnknown, setIsUnknown] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = 'Join Queue — SmartQueue';
  }, []);

  useEffect(() => {
    // 1. Not logged in: save returnTo in sessionStorage and redirect to /login
    if (!isAuthenticated) {
      if (serviceId) {
        sessionStorage.setItem('returnTo', `/join/${encodeURIComponent(serviceId)}`);
      }
      navigate('/login', { replace: true });
      return;
    }

    // 2. Staff/Admin: cannot join queues
    if (user?.role === 'staff' || user?.role === 'admin') {
      setLoading(false);
      return;
    }

    // 3. Logged-in patient: check existing active token and fetch service details
    let isMounted = true;
    async function checkAndLoad() {
      try {
        setError(null);
        const [activeTokens, servicesList] = await Promise.all([
          api.get('/api/me/tokens/active'),
          api.get('/api/services'),
        ]);

        if (!isMounted) return;

        // If patient already holds an active token for this service, navigate directly to /patient
        const activeList = Array.isArray(activeTokens) ? activeTokens : [];
        const hasExisting = activeList.some(
          (t) =>
            t.serviceId === serviceId &&
            ['waiting', 'called', 'serving'].includes(t.status)
        );

        if (hasExisting) {
          navigate('/patient', { replace: true });
          return;
        }

        // Check if service exists and is active
        const services = Array.isArray(servicesList) ? servicesList : [];
        const found = services.find((s) => s.id === serviceId);

        if (found) {
          setService(found);
        } else {
          setIsUnknown(true);
        }
      } catch (err) {
        if (isMounted) {
          setError(getFriendlyErrorMessage(err));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    checkAndLoad();
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user, serviceId, navigate]);

  const handleJoinQueue = async () => {
    if (!serviceId) return;
    setJoining(true);
    setError(null);

    try {
      await api.post(`/api/services/${serviceId}/tokens`, {});
      navigate('/patient', { replace: true });
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
      setJoining(false);
    }
  };

  // Staff account view
  if (isAuthenticated && (user?.role === 'staff' || user?.role === 'admin')) {
    return (
      <div className="min-h-screen bg-paper text-ink flex flex-col">
        <TopBar user={user} roleBadge="Staff Portal" onLogout={logout} />
        <main className="flex-1 max-w-md w-full mx-auto px-4 py-12 flex flex-col justify-center">
          <div className="p-6 rounded-[var(--radius-card)] bg-paper border border-line text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-line-subtle text-slate flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">Staff Account</h1>
              <p className="text-sm text-slate mt-1.5">
                Staff and admin accounts cannot join patient consultation queues.
              </p>
            </div>
            <div className="pt-2">
              <Link to="/staff">
                <Button variant="primary" className="w-full justify-center">
                  Go to Staff Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <TopBar user={user} onLogout={logout} />

      <main className="flex-1 max-w-md w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
        {error && (
          <div
            className="mb-4 p-4 rounded-[var(--radius-control)] bg-coral-tint text-coral border border-coral/20 flex items-start gap-3"
            role="alert"
            aria-live="polite"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="p-6 rounded-[var(--radius-card)] bg-paper border border-line space-y-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isUnknown ? (
          <div className="p-6 rounded-[var(--radius-card)] bg-paper border border-line text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-coral-tint text-coral flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">Service Not Available</h1>
              <p className="text-sm text-slate mt-1.5">
                This service could not be found or is currently inactive.
              </p>
            </div>
            <div className="pt-2">
              <Link to="/patient">
                <Button variant="secondary" className="w-full justify-center">
                  <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
                  View Available Services
                </Button>
              </Link>
            </div>
          </div>
        ) : service ? (
          <div className="p-6 sm:p-8 rounded-[var(--radius-card)] bg-paper border border-line space-y-6 shadow-sm">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate uppercase tracking-wider">
                {service.organizationName || 'Hospital OPD'}
              </p>
              <h1 className="text-2xl font-bold text-ink tracking-tight">
                {service.name}
              </h1>
            </div>

            <div className="flex items-center gap-2 p-3.5 rounded-[var(--radius-control)] bg-signal-tint text-signal text-sm font-medium">
              <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {service.waitingCount}{' '}
                {service.waitingCount === 1 ? 'patient' : 'patients'} currently waiting
              </span>
            </div>

            <p className="text-xs text-slate leading-relaxed">
              Scan confirmation: Tap below to take your place in line. You will receive a
              digital token ticket and can track your position in real time.
            </p>

            <div className="space-y-3 pt-2">
              <Button
                variant="primary"
                size="lg"
                onClick={handleJoinQueue}
                loading={joining}
                disabled={joining}
                className="w-full justify-center text-base"
                aria-label={`Join queue for ${service.name}`}
              >
                Join queue
              </Button>

              <Link to="/patient" className="block">
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={joining}
                  className="w-full justify-center text-xs"
                >
                  Cancel and view all services
                </Button>
              </Link>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default QrJoin;
