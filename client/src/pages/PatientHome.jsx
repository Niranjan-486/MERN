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
      const [servicesData, activeTokensData] = await Promise.all([
        api.get('/api/services'),
        api.get('/api/me/tokens/active'),
      ]);

      setServices(Array.isArray(servicesData) ? servicesData : []);
      setTokens(Array.isArray(activeTokensData) ? activeTokensData : []);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Resync logic: refetches active tokens and resolves any previously active token that disappeared
  const resync = useCallback(async () => {
    try {
      const [servicesData, activeTokens] = await Promise.all([
        api.get('/api/services'),
        api.get('/api/me/tokens/active'),
      ]);

      if (Array.isArray(servicesData)) {
        setServices(servicesData);
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
            });
          } catch (_) {
            // If fetch fails, retain previous with terminal assumption or keep state
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

      // Update now-serving line
      setNowServingByService((prev) => ({
        ...prev,
        [payload.serviceId]: payload.nowServing || [],
      }));

      // Update service waitingCount
      setServices((prev) =>
        prev.map((s) =>
          s.id === payload.serviceId ? { ...s, waitingCount: payload.waitingCount } : s
        )
      );
    });

    return () => {
      unsubToken();
      unsubQueue();
    };
  }, [subscribe]);

  // Join queue
  const handleJoinQueue = async (serviceId) => {
    setError(null);
    setJoiningServiceId(serviceId);
    try {
      const res = await api.post(`/api/services/${serviceId}/tokens`, {});
      const newToken = res.token;

      // Show token card immediately from API response
      const immediateCard = {
        tokenId: newToken._id,
        serviceId: newToken.serviceId,
        number: newToken.number,
        status: newToken.status,
        priority: newToken.priority,
        peopleAhead: 0,
        counterName: null,
      };

      setTokens((prev) => [
        immediateCard,
        ...prev.filter((t) => t.tokenId !== newToken._id && t.serviceId !== serviceId),
      ]);

      // Refetch services to refresh count
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
            ? { ...t, status: 'cancelled', peopleAhead: null }
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
