import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Users, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../realtime/SocketProvider';
import { api } from '../lib/api';
import { getFriendlyErrorMessage } from '../lib/errors';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { TopBar } from '../components/ui/TopBar';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { TokenCard } from '../components/TokenCard';
import { PushNotificationCard } from '../components/PushNotificationCard';

export function PatientHome() {
  const { user, logout } = useAuth();
  const { connectionStatus, subscribe } = useSocket();

  const [services, setServices] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [nowServingByService, setNowServingByService] = useState({});
  const [loading, setLoading] = useState(true);
  const [joiningServiceId, setJoiningServiceId] = useState(null);
  const [cancellingTokenId, setCancellingTokenId] = useState(null);
  const [error, setError] = useState(null);

  // Keep ref of tokens for resync comparisons
  const tokensRef = useRef(tokens);
  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  // Set default document title unless called
  useEffect(() => {
    const hasCalled = tokens.some((t) => t.status === 'called');
    if (!hasCalled) {
      document.title = 'My Queue — SmartQueue';
    }
  }, [tokens]);

  // Load initial data
  const loadInitialData = useCallback(async () => {
    try {
      setError(null);
      const [servicesData, activeTokensData, notifsData] = await Promise.all([
        api.get('/api/services'),
        api.get('/api/me/tokens/active'),
        api.get('/api/me/notifications'),
      ]);

      setServices(Array.isArray(servicesData) ? servicesData : []);
      setTokens(Array.isArray(activeTokensData) ? activeTokensData : []);
      setNotifications(Array.isArray(notifsData) ? notifsData : []);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Resync logic
  const resync = useCallback(async () => {
    try {
      const [servicesData, activeTokens, notifsData] = await Promise.all([
        api.get('/api/services'),
        api.get('/api/me/tokens/active'),
        api.get('/api/me/notifications'),
      ]);

      if (Array.isArray(servicesData)) {
        setServices(servicesData);
      }
      if (Array.isArray(notifsData)) {
        setNotifications(notifsData);
      }

      const activeList = Array.isArray(activeTokens) ? activeTokens : [];
      const activeIds = new Set(activeList.map((t) => t.tokenId));

      const currentTracked = tokensRef.current || [];
      const resolvedTokens = [...activeList];

      for (const prev of currentTracked) {
        if (!activeIds.has(prev.tokenId)) {
          try {
            const tokenRes = await api.get(`/api/tokens/${prev.tokenId}`);
            const resolved = tokenRes.token || tokenRes;
            resolvedTokens.push({
              tokenId: resolved._id || prev.tokenId,
              serviceId: resolved.serviceId,
              number: resolved.number,
              status: resolved.status,
              priority: resolved.priority,
              peopleAhead: null,
              counterName: null,
              etaSeconds: null,
              noShowInSec: null,
            });
          } catch (_) {
            resolvedTokens.push(prev);
          }
        }
      }

      setTokens(resolvedTokens);
    } catch (err) {
      console.warn('Resync failed:', err);
    }
  }, []);

  // Resync on socket reconnect and when tab becomes visible
  useEffect(() => {
    if (connectionStatus === 'live') {
      resync();
    }
  }, [connectionStatus, resync]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [resync]);

  // Real-time subscriptions
  useEffect(() => {
    // 1. token:updated
    const unsubToken = subscribe('token:updated', (payload) => {
      if (!payload || !payload.tokenId) return;
      setTokens((prev) => {
        const index = prev.findIndex((t) => t.tokenId === payload.tokenId);
        if (index >= 0) {
          const next = [...prev];
          next[index] = payload;
          return next;
        }
        return [payload, ...prev];
      });
    });

    // 2. queue:updated
    const unsubQueue = subscribe('queue:updated', (payload) => {
      if (!payload || !payload.serviceId) return;

      setNowServingByService((prev) => ({
        ...prev,
        [payload.serviceId]: payload.nowServing || [],
      }));

      setServices((prev) =>
        prev.map((s) =>
          s.id === payload.serviceId ? { ...s, waitingCount: payload.waitingCount } : s
        )
      );
    });

    // 3. notification:new -> Sonner toast
    const unsubNotif = subscribe('notification:new', (payload) => {
      if (!payload || !payload.id) return;
      toast(payload.title, {
        description: payload.body,
        duration: 6000,
      });
      setNotifications((prev) => [payload, ...prev.filter((n) => n.id !== payload.id)]);
    });

    return () => {
      unsubToken();
      unsubQueue();
      unsubNotif();
    };
  }, [subscribe]);

  // Join queue
  const handleJoinQueue = async (serviceId) => {
    setError(null);
    setJoiningServiceId(serviceId);
    try {
      const res = await api.post(`/api/services/${serviceId}/tokens`, {});
      const newToken = res.token;

      const immediateCard = {
        tokenId: newToken._id,
        serviceId: newToken.serviceId,
        number: newToken.number,
        status: newToken.status,
        priority: newToken.priority,
        peopleAhead: 0,
        counterName: null,
        etaSeconds: null,
        noShowInSec: null,
      };

      setTokens((prev) => [
        immediateCard,
        ...prev.filter((t) => t.tokenId !== newToken._id && t.serviceId !== serviceId),
      ]);

      const updatedServices = await api.get('/api/services');
      if (Array.isArray(updatedServices)) {
        setServices(updatedServices);
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setJoiningServiceId(null);
    }
  };

  // Cancel token
  const handleCancelToken = async (token) => {
    setError(null);
    setCancellingTokenId(token.tokenId);
    try {
      const res = await api.post(`/api/tokens/${token.tokenId}/cancel`, {});
      const cancelled = res.token || token;
      setTokens((prev) =>
        prev.map((t) =>
          t.tokenId === token.tokenId
            ? { ...t, status: 'cancelled', peopleAhead: null, noShowInSec: null }
            : t
        )
      );
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setCancellingTokenId(null);
    }
  };

  const getServiceName = (serviceId) => {
    const s = services.find((svc) => svc.id === serviceId);
    return s ? s.name : 'OPD Service';
  };

  const hasActiveTokenInService = (serviceId) => {
    return tokens.some(
      (t) =>
        t.serviceId === serviceId && ['waiting', 'called', 'serving'].includes(t.status)
    );
  };

  const getNowServingSummary = (serviceId) => {
    const list = nowServingByService[serviceId] || [];
    if (!list || list.length === 0) return 'None';
    return list
      .map((item) => `${item.counterName || 'Desk'} (#${item.tokenNumber})`)
      .join(', ');
  };

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <TopBar user={user} onLogout={logout} />

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 sm:px-6 space-y-8">
        {error && (
          <div
            className="p-4 rounded-[var(--radius-control)] bg-coral-tint text-coral border border-coral/20 flex items-start gap-3"
            role="alert"
            aria-live="polite"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}

        {/* Web Push Notification Card */}
        <PushNotificationCard />

        {/* Active Tokens Section */}
        <section aria-label="My Tokens" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink tracking-tight">Your Token</h2>
          </div>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-64 w-full rounded-[var(--radius-ticket)]" />
            </div>
          ) : tokens.length === 0 ? (
            <EmptyState
              title="No active tokens"
              description="You are not waiting in any queue. Choose a service below to take a token."
            />
          ) : (
            <div className="space-y-6">
              {tokens.map((token) => (
                <TokenCard
                  key={token.tokenId}
                  token={token}
                  serviceName={getServiceName(token.serviceId)}
                  nowServingSummary={getNowServingSummary(token.serviceId)}
                  onCancel={handleCancelToken}
                  onJoinAgain={handleJoinQueue}
                  isCancelling={cancellingTokenId === token.tokenId}
                />
              ))}
            </div>
          )}
        </section>

        {/* Available Services Section (Rows, not card grid) */}
        <section aria-label="Available Services" className="space-y-3">
          <h2 className="text-lg font-bold text-ink tracking-tight">Choose a service</h2>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-[var(--radius-control)]" />
              <Skeleton className="h-16 w-full rounded-[var(--radius-control)]" />
            </div>
          ) : services.length === 0 ? (
            <div className="text-sm text-slate py-4 text-center">
              No active services currently available.
            </div>
          ) : (
            <div className="border border-line rounded-[var(--radius-card)] divide-y divide-line bg-paper overflow-hidden shadow-xs">
              {services.map((svc) => {
                const isAlreadyJoined = hasActiveTokenInService(svc.id);
                const isJoiningThis = joiningServiceId === svc.id;

                return (
                  <article
                    key={svc.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-line-subtle/30 transition-colors duration-150"
                  >
                    <div className="space-y-1">
                      <h3 className="font-semibold text-ink text-base leading-snug">
                        {svc.name}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-slate">
                        <span>{svc.organizationName}</span>
                        <span aria-hidden="true">•</span>
                        <span className="flex items-center gap-1 font-medium text-ink">
                          <Users className="w-3.5 h-3.5 text-slate" aria-hidden="true" />
                          <span>{svc.waitingCount} waiting</span>
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0 self-start sm:self-center">
                      <Button
                        variant={isAlreadyJoined ? 'secondary' : 'primary'}
                        size="sm"
                        onClick={() => handleJoinQueue(svc.id)}
                        disabled={isAlreadyJoined || isJoiningThis}
                        loading={isJoiningThis}
                        aria-label={`Join queue for ${svc.name}`}
                      >
                        {isAlreadyJoined ? 'In queue' : 'Join queue'}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Updates Timeline */}
        {notifications.length > 0 && (
          <section aria-label="Recent updates" className="space-y-3 pt-2">
            <h2 className="text-lg font-bold text-ink tracking-tight">Recent updates</h2>
            <div className="border border-line rounded-[var(--radius-card)] divide-y divide-line bg-paper overflow-hidden shadow-xs">
              {notifications.slice(0, 5).map((n) => (
                <article key={n.id} className="p-4 flex items-start gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-signal mt-1.5 shrink-0" aria-hidden="true" />
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink text-[13px]">{n.title}</span>
                      <time className="text-slate font-medium text-[11px] whitespace-nowrap">
                        {formatRelativeTime(n.createdAt)}
                      </time>
                    </div>
                    <p className="text-slate text-xs leading-normal">{n.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-slate py-6 border-t border-line mt-12">
        <p>SmartQueue • OPD consultation queue system</p>
      </footer>
    </div>
  );
}

export default PatientHome;
