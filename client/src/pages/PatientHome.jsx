import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../realtime/SocketProvider';
import { api } from '../lib/api';
import { getFriendlyErrorMessage } from '../lib/errors';
import { TokenCard } from '../components/TokenCard';

export function PatientHome() {
  const { user, logout } = useAuth();
  const { connectionStatus, subscribe } = useSocket();

  const [services, setServices] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeToast, setActiveToast] = useState(null);
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

  // Resync logic: refetches active tokens, services, and notifications
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

      // Check tokens we previously tracked
      const currentTracked = tokensRef.current || [];
      const resolvedTokens = [...activeList];

      for (const prev of currentTracked) {
        if (!activeIds.has(prev.tokenId)) {
          // Previously known token is missing from active list -> fetch its final status
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

  // Auto-dismiss active notification toast after 6 seconds
  useEffect(() => {
    if (!activeToast) return;
    const timer = setTimeout(() => {
      setActiveToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [activeToast]);

  // Real-time subscriptions
  useEffect(() => {
    // 1. token:updated replaces that token's state
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

    // 2. queue:updated updates now serving and waiting counts
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

    // 3. notification:new displays a toast banner and updates recent list
    const unsubNotif = subscribe('notification:new', (payload) => {
      if (!payload || !payload.id) return;
      setActiveToast(payload);
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

  // Resolve service name by id
  const getServiceName = (serviceId) => {
    const s = services.find((svc) => svc.id === serviceId);
    return s ? s.name : 'OPD Service';
  };

  // Check if user holds an active token for this service
  const hasActiveTokenInService = (serviceId) => {
    return tokens.some(
      (t) =>
        t.serviceId === serviceId && ['waiting', 'called', 'serving'].includes(t.status)
    );
  };

  // Format now serving list into a human-readable summary
  const getNowServingSummary = (serviceId) => {
    const list = nowServingByService[serviceId] || [];
    if (!list || list.length === 0) return 'None at the moment';
    return list
      .map((item) => `${item.counterName || 'Desk'} (#${item.tokenNumber})`)
      .join(', ');
  };

  return (
    <div className="patient-layout">
      {/* Toast Banner for live notifications */}
      {activeToast && (
        <aside
          className={`toast-banner toast-${activeToast.kind}`}
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            zIndex: 1000,
            maxWidth: '380px',
            padding: '1rem',
            backgroundColor: activeToast.kind === 'no_show' ? '#fff5f5' : '#f0fff4',
            border: `1px solid ${activeToast.kind === 'no_show' ? '#feb2b2' : '#9ae6b4'}`,
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <div className="toast-content">
            <strong
              style={{
                display: 'block',
                color: activeToast.kind === 'no_show' ? '#9b2c2c' : '#22543d',
                marginBottom: '0.25rem',
              }}
            >
              {activeToast.title}
            </strong>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#2d3748' }}>
              {activeToast.body}
            </p>
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => setActiveToast(null)}
            aria-label="Dismiss notification"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#718096',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </aside>
      )}

      <header className="app-navbar">
        <div className="navbar-brand">⚡ SmartQueue</div>
        <div className="navbar-user">
          <span className="user-greeting">Hi, {user?.name || 'Patient'}</span>
          <span
            className={`connection-badge ${connectionStatus}`}
            title={`Socket status: ${connectionStatus}`}
          >
            <span className="status-dot"></span>
            {connectionStatus === 'live' ? 'Live' : 'Reconnecting...'}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={logout}
            aria-label="Log out"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="patient-content">
        {error && (
          <div className="error-banner" role="alert" aria-live="polite">
            {error}
          </div>
        )}

        {/* Active Tokens Section */}
        <section className="patient-tokens-section" aria-label="My Tokens">
          <h2 className="section-title">My Queue Tokens</h2>

          {loading ? (
            <p className="loading-text">Loading queue status...</p>
          ) : tokens.length === 0 ? (
            <div className="empty-card">
              <p>You have no active tokens. Choose a service below to join the queue.</p>
            </div>
          ) : (
            <div className="tokens-grid">
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

        {/* Recent Updates Section */}
        {notifications.length > 0 && (
          <section
            className="patient-notifications-section"
            aria-label="Recent updates"
            style={{ marginTop: '2rem' }}
          >
            <h2 className="section-title">Recent Updates</h2>
            <div
              className="notifications-list"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
            >
              {notifications.slice(0, 5).map((n) => (
                <article
                  key={n.id}
                  className={`notification-card kind-${n.kind}`}
                  style={{
                    padding: '0.875rem 1rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <span
                      className={`badge badge-${n.kind}`}
                      style={{
                        padding: '0.2rem 0.5rem',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        borderRadius: '4px',
                        textTransform: 'uppercase',
                        backgroundColor:
                          n.kind === 'near'
                            ? '#feebc8'
                            : n.kind === 'called'
                            ? '#c6f6d5'
                            : '#fed7d7',
                        color:
                          n.kind === 'near'
                            ? '#7b341e'
                            : n.kind === 'called'
                            ? '#22543d'
                            : '#742a2a',
                      }}
                    >
                      {n.kind === 'no_show' ? 'No Show' : n.kind}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#718096' }}>
                      {n.createdAt
                        ? new Date(n.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                    </span>
                  </div>
                  <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '0.95rem' }}>
                    {n.title}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: '#4a5568' }}>
                    {n.body}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Available Services Section */}
        <section className="patient-services-section" aria-label="Available Services">
          <h2 className="section-title">Available OPD Services</h2>

          {loading ? (
            <p className="loading-text">Loading services...</p>
          ) : services.length === 0 ? (
            <p className="empty-text">No active services currently available.</p>
          ) : (
            <div className="services-list">
              {services.map((svc) => {
                const isAlreadyJoined = hasActiveTokenInService(svc.id);
                const isJoiningThis = joiningServiceId === svc.id;

                return (
                  <article key={svc.id} className="service-card">
                    <div className="service-info">
                      <h3 className="service-name">{svc.name}</h3>
                      <p className="service-org">{svc.organizationName}</p>
                      <p className="service-waiting">
                        Currently waiting: <strong>{svc.waitingCount}</strong>
                      </p>
                    </div>

                    <div className="service-action">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleJoinQueue(svc.id)}
                        disabled={isAlreadyJoined || isJoiningThis}
                        aria-label={`Join queue for ${svc.name}`}
                      >
                        {isJoiningThis
                          ? 'Joining...'
                          : isAlreadyJoined
                          ? 'Already in queue'
                          : 'Join queue'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
