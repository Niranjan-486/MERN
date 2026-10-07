import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../realtime/SocketProvider';
import { api } from '../lib/api';
import { getFriendlyErrorMessage } from '../lib/errors';
import { createCoalescedRunner } from '../lib/coalescedRunner';

export function StaffDashboard() {
  const { user, logout } = useAuth();
  const { connectionStatus, subscribe } = useSocket();

  const [counters, setCounters] = useState([]);
  const [selectedCounterId, setSelectedCounterId] = useState(() => {
    return localStorage.getItem('selectedCounterId') || '';
  });
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [error, setError] = useState(null);

  // Keep ref to selectedCounterId and dashboard for subscriptions
  const selectedCounterIdRef = useRef(selectedCounterId);
  useEffect(() => {
    selectedCounterIdRef.current = selectedCounterId;
  }, [selectedCounterId]);

  const dashboardRef = useRef(dashboard);
  useEffect(() => {
    dashboardRef.current = dashboard;
  }, [dashboard]);

  // Fetch dashboard data
  const fetchDashboard = useCallback(async () => {
    const counterId = selectedCounterIdRef.current;
    if (!counterId) return;

    try {
      const data = await api.get(`/api/counters/${counterId}/dashboard`);
      setDashboard(data);
    } catch (err) {
      console.warn('Dashboard fetch error:', err);
      setError(getFriendlyErrorMessage(err));
    }
  }, []);

  // Coalesced runner instance
  const coalescedRunnerRef = useRef(null);
  if (!coalescedRunnerRef.current) {
    coalescedRunnerRef.current = createCoalescedRunner(fetchDashboard);
  }

  // Load counters list on mount
  useEffect(() => {
    let isMounted = true;
    async function loadCounters() {
      try {
        setError(null);
        const data = await api.get('/api/counters');
        if (!isMounted) return;
        const list = Array.isArray(data) ? data : [];
        setCounters(list);

        // Auto-select if stored counter exists in list, else pick first
        let currentId = selectedCounterId;
        const found = list.find((c) => c.id === currentId);
        if (!found && list.length > 0) {
          currentId = list[0].id;
          setSelectedCounterId(currentId);
          localStorage.setItem('selectedCounterId', currentId);
        }
      } catch (err) {
        if (isMounted) setError(getFriendlyErrorMessage(err));
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadCounters();
    return () => {
      isMounted = false;
    };
  }, []);

  // When selected counter changes, fetch dashboard
  useEffect(() => {
    if (selectedCounterId) {
      localStorage.setItem('selectedCounterId', selectedCounterId);
      coalescedRunnerRef.current.run();
    }
  }, [selectedCounterId]);

  // Resync on socket reconnect and when tab becomes visible
  useEffect(() => {
    if (connectionStatus === 'live' && selectedCounterId) {
      coalescedRunnerRef.current.run();
    }
  }, [connectionStatus, selectedCounterId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && selectedCounterIdRef.current) {
        coalescedRunnerRef.current.run();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Live updates: on queue:updated for the counter's service, refetch via coalescedRunner
  useEffect(() => {
    const unsub = subscribe('queue:updated', (payload) => {
      const currentServiceId = dashboardRef.current?.service?.id;
      if (payload && payload.serviceId === currentServiceId) {
        coalescedRunnerRef.current.run();
      }
    });
    return () => unsub();
  }, [subscribe]);

  // Execute a counter action safely, running coalescedRunner in finally block
  const executeAction = async (actionFn) => {
    setError(null);
    setActionInFlight(true);
    try {
      await actionFn();
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setActionInFlight(false);
      // Refetch after every action (success or error)
      coalescedRunnerRef.current.run();
    }
  };

  const handleCallNext = () => {
    if (!selectedCounterId) return;
    executeAction(async () => {
      await api.post(`/api/counters/${selectedCounterId}/call-next`, {});
    });
  };

  const handleStartServing = () => {
    if (!dashboard?.current?.tokenId || !selectedCounterId) return;
    executeAction(async () => {
      await api.post(`/api/tokens/${dashboard.current.tokenId}/start`, {
        counterId: selectedCounterId,
      });
    });
  };

  const handleSkip = () => {
    if (!dashboard?.current?.tokenId || !selectedCounterId) return;
    executeAction(async () => {
      await api.post(`/api/tokens/${dashboard.current.tokenId}/skip`, {
        counterId: selectedCounterId,
      });
    });
  };

  const handleComplete = () => {
    if (!dashboard?.current?.tokenId || !selectedCounterId) return;
    executeAction(async () => {
      await api.post(`/api/tokens/${dashboard.current.tokenId}/complete`, {
        counterId: selectedCounterId,
      });
    });
  };

  const isHoldingToken = Boolean(dashboard?.current);
  const isQueueEmpty = (dashboard?.waitingCount ?? 0) === 0;
  const isCallNextDisabled = isHoldingToken || isQueueEmpty || actionInFlight;

  return (
    <div className="staff-layout">
      {/* Staff Header */}
      <header className="staff-navbar">
        <div className="navbar-brand">
          ⚡ SmartQueue <span className="badge badge-staff">Staff Portal</span>
        </div>
        <div className="navbar-controls">
          <div className="counter-picker-group">
            <label htmlFor="counter-picker" className="picker-label">
              Desk:
            </label>
            <select
              id="counter-picker"
              className="counter-select"
              value={selectedCounterId}
              onChange={(e) => setSelectedCounterId(e.target.value)}
              disabled={loading || actionInFlight}
            >
              {counters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.serviceName})
                </option>
              ))}
            </select>
          </div>

          <span className={`connection-badge ${connectionStatus}`}>
            <span className="status-dot"></span>
            {connectionStatus === 'live' ? 'Live' : 'Reconnecting...'}
          </span>

          <span className="user-greeting">{user?.name || 'Staff'}</span>
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

      {/* Main Staff Dashboard */}
      <main className="staff-content">
        {error && (
          <div className="error-banner" role="alert" aria-live="polite">
            {error}
          </div>
        )}

        {loading ? (
          <p className="loading-text">Loading desk dashboard...</p>
        ) : !selectedCounterId ? (
          <div className="empty-card">
            <p>No desk selected. Please configure a counter in your organization.</p>
          </div>
        ) : (
          <div className="dashboard-grid">
            {/* Top Bar: Counter & Service Info + Big Call Next */}
            <section className="dashboard-banner">
              <div className="banner-titles">
                <h1 className="desk-title">{dashboard?.counter?.name || 'Counter'}</h1>
                <p className="desk-service">
                  Service: <strong>{dashboard?.service?.name || 'General OPD'}</strong>
                </p>
              </div>

              <div className="banner-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-call-next"
                  onClick={handleCallNext}
                  disabled={isCallNextDisabled}
                  aria-label="Call next patient"
                >
                  {actionInFlight ? 'Processing...' : 'Call Next'}
                </button>
                {isHoldingToken && (
                  <span className="call-hint">Complete current patient before calling next</span>
                )}
                {!isHoldingToken && isQueueEmpty && (
                  <span className="call-hint">Queue is currently empty</span>
                )}
              </div>
            </section>

            {/* Middle Section: Current Patient Card */}
            <section className="current-patient-panel" aria-label="Current Patient">
              <h2 className="panel-title">Current Patient</h2>
              {dashboard?.current ? (
                <div className={`current-card status-${dashboard.current.status}`}>
                  <div className="current-meta">
                    <span className="current-token-number">#{dashboard.current.number}</span>
                    <span className={`badge badge-${dashboard.current.status}`}>
                      {dashboard.current.status.toUpperCase()}
                    </span>
                    {dashboard.current.priority === 1 && (
                      <span className="priority-tag senior">Senior Citizen</span>
                    )}
                    {dashboard.current.priority === 2 && (
                      <span className="priority-tag emergency">Emergency</span>
                    )}
                  </div>

                  <p className="current-patient-name">
                    Patient: <strong>{dashboard.current.patientName || 'Anonymous'}</strong>
                  </p>

                  <div className="current-actions">
                    {dashboard.current.status === 'called' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-success"
                          onClick={handleStartServing}
                          disabled={actionInFlight}
                          aria-label="Start serving patient"
                        >
                          Start Serving
                        </button>
                        <button
                          type="button"
                          className="btn btn-warning"
                          onClick={handleSkip}
                          disabled={actionInFlight}
                          aria-label="Skip patient"
                        >
                          Skip
                        </button>
                      </>
                    )}

                    {dashboard.current.status === 'serving' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-complete"
                        onClick={handleComplete}
                        disabled={actionInFlight}
                        aria-label="Complete service"
                      >
                        Complete Consultation
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="empty-panel">
                  <p>No patient currently called at this desk.</p>
                </div>
              )}
            </section>

            {/* Waiting List Column */}
            <section className="waiting-list-panel" aria-label="Waiting Patients">
              <div className="panel-header">
                <h2 className="panel-title">Waiting Queue</h2>
                <span className="badge badge-counter">
                  Total Waiting: {dashboard?.waitingCount ?? 0}
                </span>
              </div>

              {!dashboard?.waiting || dashboard.waiting.length === 0 ? (
                <p className="empty-text">No patients waiting in queue.</p>
              ) : (
                <div className="waiting-table-container">
                  <table className="waiting-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Token</th>
                        <th>Patient Name</th>
                        <th>Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.waiting.map((t, idx) => (
                        <tr key={t.tokenId}>
                          <td>{idx + 1}</td>
                          <td>
                            <strong>#{t.number}</strong>
                          </td>
                          <td>{t.patientName || 'Patient'}</td>
                          <td>
                            {t.priority === 2 ? (
                              <span className="priority-tag emergency">Emergency</span>
                            ) : t.priority === 1 ? (
                              <span className="priority-tag senior">Senior</span>
                            ) : (
                              <span className="priority-tag normal">Normal</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {dashboard.waitingCount > 20 && (
                    <p className="table-caption">
                      Showing next 20 of {dashboard.waitingCount} waiting patients in call order.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Now Serving List Across Other Desks */}
            <section className="now-serving-panel" aria-label="Active Desks">
              <h2 className="panel-title">Now Serving in Service</h2>
              {!dashboard?.nowServing || dashboard.nowServing.length === 0 ? (
                <p className="empty-text">No active tokens at other desks.</p>
              ) : (
                <div className="serving-grid">
                  {dashboard.nowServing.map((item) => (
                    <div
                      key={item.counterId || item.tokenNumber}
                      className="serving-card"
                    >
                      <span className="serving-desk">{item.counterName || 'Desk'}</span>
                      <span className="serving-token">#{item.tokenNumber}</span>
                      <span className={`badge badge-${item.status}`}>
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
