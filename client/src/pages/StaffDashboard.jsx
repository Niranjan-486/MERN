import React, { useState, useEffect, useCallback, useRef } from 'react';
import { m } from 'motion/react';
import {
  Users,
  Clock,
  PhoneCall,
  CheckCircle,
  SkipForward,
  Activity,
  Layers,
  AlertCircle,
  QrCode,
  Printer,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../realtime/SocketProvider';
import { api } from '../lib/api';
import { getFriendlyErrorMessage } from '../lib/errors';
import { createCoalescedRunner } from '../lib/coalescedRunner';
import { formatEta } from '../lib/formatEta';
import { TopBar } from '../components/ui/TopBar';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { DotNumber } from '../components/ui/DotNumber';
import { Countdown } from '../components/ui/Countdown';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export function StaffDashboard() {
  const { user, logout } = useAuth();
  const { connectionStatus, subscribe } = useSocket();

  const [counters, setCounters] = useState([]);
  const [selectedCounterId, setSelectedCounterId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [error, setError] = useState(null);
  const [isSkipDialogOpen, setIsSkipDialogOpen] = useState(false);
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);

  const primaryActionRef = useRef(null);

  // Keep ref to selectedCounterId and dashboard for subscriptions
  const selectedCounterIdRef = useRef(selectedCounterId);
  useEffect(() => {
    selectedCounterIdRef.current = selectedCounterId;
  }, [selectedCounterId]);

  const dashboardRef = useRef(dashboard);
  useEffect(() => {
    dashboardRef.current = dashboard;
  }, [dashboard]);

  // Set document title
  useEffect(() => {
    if (dashboard?.counter?.name) {
      document.title = `${dashboard.counter.name} — SmartQueue Staff`;
    } else {
      document.title = 'Staff Dashboard — SmartQueue';
    }
  }, [dashboard?.counter?.name]);

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
        // The counter picker must ignore offline counters
        const activeCounters = list.filter((c) => c.status !== 'offline');
        setCounters(activeCounters);

        const storedId = localStorage.getItem('selectedCounterId');
        const isStoredInList = Boolean(storedId && activeCounters.some((c) => c.id === storedId));

        // If a counter id remembered in localStorage is no longer in the list, clear it
        if (storedId && !isStoredInList) {
          localStorage.removeItem('selectedCounterId');
        }

        if (activeCounters.length === 1) {
          // Exactly one non-offline counter: skip picker and open its dashboard directly
          const singleId = activeCounters[0].id;
          setSelectedCounterId(singleId);
          localStorage.setItem('selectedCounterId', singleId);
        } else if (activeCounters.length >= 2) {
          // Keep picker for two or more
          if (isStoredInList) {
            setSelectedCounterId(storedId);
          } else {
            setSelectedCounterId('');
          }
        } else {
          setSelectedCounterId('');
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

  // Live updates
  useEffect(() => {
    const unsub = subscribe('queue:updated', (payload) => {
      const currentServiceId = dashboardRef.current?.service?.id;
      if (payload && payload.serviceId === currentServiceId) {
        coalescedRunnerRef.current.run();
      }
    });
    return () => unsub();
  }, [subscribe]);

  // Action executor
  const executeAction = async (actionFn) => {
    setError(null);
    setActionInFlight(true);
    try {
      await actionFn();
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setActionInFlight(false);
      coalescedRunnerRef.current.run();
      // Refocus primary button for rapid keyboard operations
      setTimeout(() => {
        primaryActionRef.current?.focus();
      }, 50);
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

  const handleSkipConfirm = () => {
    if (!dashboard?.current?.tokenId || !selectedCounterId) return;
    setIsSkipDialogOpen(false);
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

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      const targetTag = e.target.tagName.toLowerCase();
      if (['input', 'textarea', 'select'].includes(targetTag)) {
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        if (!isHoldingToken && !isCallNextDisabled) {
          e.preventDefault();
          handleCallNext();
        } else if (dashboard?.current?.status === 'called' && !actionInFlight) {
          e.preventDefault();
          handleStartServing();
        } else if (dashboard?.current?.status === 'serving' && !actionInFlight) {
          e.preventDefault();
          handleComplete();
        }
      } else if (e.key.toLowerCase() === 'k' && dashboard?.current?.status === 'called') {
        e.preventDefault();
        setIsSkipDialogOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHoldingToken, isCallNextDisabled, dashboard?.current?.status, actionInFlight]);

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      {/* TopBar with brand, counter picker (if >= 2), connection status, theme toggle, and logout */}
      <TopBar
        user={user}
        roleBadge="Staff Portal"
        connectionStatus={connectionStatus}
        onLogout={logout}
      >
        {counters.length >= 2 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="counter-picker"
              className="text-xs font-semibold text-slate uppercase tracking-wider"
            >
              Desk:
            </label>
            <select
              id="counter-picker"
              aria-label="Desk"
              className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-ink bg-paper border border-line rounded-[var(--radius-control)] focus:outline-none focus:ring-2 focus:ring-signal"
              value={selectedCounterId}
              onChange={(e) => setSelectedCounterId(e.target.value)}
              disabled={loading || actionInFlight}
            >
              {!selectedCounterId && <option value="">Select a desk</option>}
              {counters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.serviceName})
                </option>
              ))}
            </select>
          </div>
        )}
      </TopBar>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:px-6 space-y-6">
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

        {loading ? (
          <div className="space-y-6">
            <Skeleton className="h-14 w-full rounded-[var(--radius-card)]" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <Skeleton className="lg:col-span-7 h-72 rounded-[var(--radius-card)]" />
              <Skeleton className="lg:col-span-5 h-72 rounded-[var(--radius-card)]" />
            </div>
          </div>
        ) : !selectedCounterId ? (
          <EmptyState
            title="No desk selected"
            description={
              counters.length === 0
                ? 'No active desk found. Please configure a counter in your organization.'
                : 'Select a desk from the picker above to open its consultation dashboard.'
            }
          />
        ) : (
          <div className="space-y-6">
            {/* Header Banner: Desk title, Service & Avg Time */}
            <section
              className="p-4 sm:p-5 rounded-[var(--radius-card)] bg-paper border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
              aria-label="Desk Overview"
            >
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">
                  {dashboard?.counter?.name || 'Counter'}
                </h1>
                <p className="text-xs sm:text-sm text-slate mt-0.5">
                  Service:{' '}
                  <strong className="font-semibold text-ink">
                    {dashboard?.service?.name || 'General OPD'}
                  </strong>
                  {dashboard?.service?.avgServiceSec != null && (
                    <span className="ml-2 pl-2 border-l border-line">
                      Avg service time: {Math.round(dashboard.service.avgServiceSec / 60)} min
                    </span>
                  )}
                </p>
              </div>

              {/* Call Next & Show QR Buttons in Banner */}
              <div className="flex flex-col sm:items-end gap-1">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {dashboard?.service?.id && (
                    <Button
                      variant="secondary"
                      size="default"
                      onClick={() => setIsQrDialogOpen(true)}
                      aria-label="Show QR code for this service"
                      className="w-full sm:w-auto"
                    >
                      <QrCode className="w-4 h-4 mr-2" aria-hidden="true" />
                      <span>Show QR</span>
                    </Button>
                  )}
                  <Button
                    ref={!isHoldingToken ? primaryActionRef : undefined}
                    variant="primary"
                    size="default"
                    onClick={handleCallNext}
                    disabled={isCallNextDisabled}
                    loading={actionInFlight && !isHoldingToken}
                    aria-label="Call next patient"
                    className="w-full sm:w-auto"
                  >
                    <PhoneCall className="w-4 h-4 mr-2" aria-hidden="true" />
                    <span>Call Next</span>
                    <kbd className="ml-2 px-1.5 py-0.5 text-[10px] uppercase font-mono tracking-wider bg-white/20 rounded">
                      Space
                    </kbd>
                  </Button>
                </div>
                {isHoldingToken && (
                  <span className="text-[11px] text-slate">
                    Complete current patient before calling next
                  </span>
                )}
                {!isHoldingToken && isQueueEmpty && (
                  <span className="text-[11px] text-slate">Queue is currently empty</span>
                )}
              </div>
            </section>

            {/* Main 2-column Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Now Serving Hero Section (LED Board Motif) */}
              <section
                aria-label="Current Patient"
                className="lg:col-span-7 rounded-[var(--radius-card)] overflow-hidden border border-[#22333E] bg-[#0A1318] text-led shadow-md"
              >
                <div className="p-4 sm:p-5 border-b border-[#1A2630] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-led animate-pulse" aria-hidden="true" />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A0B0BA]">
                      Current Desk Consultation
                    </h2>
                  </div>
                  {dashboard?.current && (
                    <div className="flex items-center gap-2">
                      <StatusPill status={dashboard.current.status} />
                      {dashboard.current.priority > 0 && (
                        <StatusPill priority={dashboard.current.priority} />
                      )}
                    </div>
                  )}
                </div>

                <div className="p-6 text-center space-y-4">
                  {dashboard?.current ? (
                    <>
                      <div className="py-2">
                        <DotNumber
                          number={dashboard.current.number}
                          className="text-6xl sm:text-7xl font-bold text-led drop-shadow-[0_0_12px_rgba(255,178,36,0.35)]"
                        />
                      </div>

                      <div className="space-y-1">
                        <p className="text-base font-medium text-white/95">
                          Patient:{' '}
                          <strong className="font-semibold text-white">
                            {dashboard.current.patientName || 'Anonymous'}
                          </strong>
                        </p>
                        {dashboard.current.status === 'called' && (
                          <div className="pt-1">
                            <Countdown
                              seconds={dashboard.current.noShowInSec}
                              className="text-led font-semibold"
                            />
                          </div>
                        )}
                      </div>

                      {/* Primary Actions for Current Patient */}
                      <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
                        {dashboard.current.status === 'called' && (
                          <>
                            <Button
                              ref={primaryActionRef}
                              variant="primary"
                              onClick={handleStartServing}
                              disabled={actionInFlight}
                              loading={actionInFlight}
                              aria-label="Start serving patient"
                            >
                              <Activity className="w-4 h-4 mr-1.5" aria-hidden="true" />
                              <span>Start Serving</span>
                              <kbd className="ml-2 px-1.5 py-0.5 text-[10px] uppercase font-mono tracking-wider bg-white/20 rounded">
                                Enter
                              </kbd>
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => setIsSkipDialogOpen(true)}
                              disabled={actionInFlight}
                              aria-label="Skip patient"
                              className="text-slate hover:text-coral hover:border-coral/50"
                            >
                              <SkipForward className="w-4 h-4 mr-1.5" aria-hidden="true" />
                              <span>Skip</span>
                              <kbd className="ml-2 px-1.5 py-0.5 text-[10px] uppercase font-mono tracking-wider bg-line-subtle text-slate rounded">
                                K
                              </kbd>
                            </Button>
                          </>
                        )}

                        {dashboard.current.status === 'serving' && (
                          <Button
                            ref={primaryActionRef}
                            variant="primary"
                            onClick={handleComplete}
                            disabled={actionInFlight}
                            loading={actionInFlight}
                            aria-label="Complete service"
                            className="w-full sm:w-auto"
                          >
                            <CheckCircle className="w-4 h-4 mr-1.5" aria-hidden="true" />
                            <span>Complete Consultation</span>
                            <kbd className="ml-2 px-1.5 py-0.5 text-[10px] uppercase font-mono tracking-wider bg-white/20 rounded">
                              Space
                            </kbd>
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="py-8 space-y-3">
                      <div className="font-dot text-5xl text-[#3A4B56] select-none">--</div>
                      <p className="text-sm text-[#7D909D]">
                        No patient currently called at this desk.
                      </p>
                      <p className="text-xs text-[#526470]">
                        Use the <strong>Call Next</strong> button above or press{' '}
                        <kbd className="px-1.5 py-0.5 font-mono text-[11px] bg-[#14222B] text-slate rounded">
                          Space
                        </kbd>{' '}
                        to summon the next waiting patient.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Right Column: Waiting Queue (with Motion Layout Reordering) */}
              <section
                aria-label="Waiting Patients"
                className="lg:col-span-5 rounded-[var(--radius-card)] bg-paper border border-line shadow-xs overflow-hidden"
              >
                <div className="p-4 border-b border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-slate" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-ink">Waiting Queue</h2>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-signal-tint text-signal">
                    {dashboard?.waitingCount ?? 0} waiting
                  </span>
                </div>

                {!dashboard?.waiting || dashboard.waiting.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate">
                    Queue is clear. Call next when patients arrive.
                  </div>
                ) : (
                  <div>
                    <m.ul className="divide-y divide-line">
                      {dashboard.waiting.map((t, idx) => (
                        <m.li
                          key={t.tokenId}
                          layout
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          className="p-3.5 flex items-center justify-between gap-3 bg-paper"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-mono text-slate w-5 shrink-0">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <strong className="text-sm font-bold text-ink">
                                  #{t.number}
                                </strong>
                                {t.priority > 0 && <StatusPill priority={t.priority} />}
                              </div>
                              <p className="text-xs text-slate truncate">
                                {t.patientName || 'Patient'}
                              </p>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-xs font-medium text-slate">
                              {formatEta(t.etaSeconds) || '—'}
                            </span>
                          </div>
                        </m.li>
                      ))}
                    </m.ul>

                    {dashboard.waitingCount > 20 && (
                      <div className="p-2.5 text-[11px] text-slate bg-line-subtle/40 text-center border-t border-line">
                        Showing next 20 of {dashboard.waitingCount} waiting patients in call order.
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* Bottom Row: Active Desks in Service */}
            {dashboard?.nowServing && dashboard.nowServing.length > 0 && (
              <section
                aria-label="Active Desks"
                className="p-4 sm:p-5 rounded-[var(--radius-card)] bg-paper border border-line shadow-xs space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-ink">Now Serving in Service</h3>
                </div>

                <div className="flex flex-wrap gap-3">
                  {dashboard.nowServing.map((item) => (
                    <div
                      key={item.counterId || item.tokenNumber}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-control)] bg-line-subtle/50 border border-line text-xs"
                    >
                      <span className="font-medium text-slate">
                        {item.counterName || 'Desk'}:
                      </span>
                      <strong className="font-bold text-ink font-dot text-sm">
                        #{item.tokenNumber}
                      </strong>
                      <StatusPill status={item.status} className="text-[10px] py-0.5 px-1.5" />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Confirm Skip Dialog */}
      <ConfirmDialog
        open={isSkipDialogOpen}
        onOpenChange={setIsSkipDialogOpen}
        title="Skip this patient?"
        description={
          dashboard?.current
            ? `Mark token #${dashboard.current.number} as skipped? This will remove the patient from the desk.`
            : 'Mark patient as skipped?'
        }
        confirmText="Skip patient"
        cancelText="Keep patient"
        confirmVariant="danger"
        isLoading={actionInFlight}
        onConfirm={handleSkipConfirm}
      />

      {/* Service QR Code Dialog */}
      <Dialog.Root open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs no-print" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] bg-paper p-6 shadow-xl border border-line focus:outline-none qr-print-poster">
            <div className="flex items-center justify-between no-print mb-2 w-full">
              <span className="text-xs font-semibold text-slate uppercase tracking-wider">Queue QR Code</span>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="p-1 rounded text-slate hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                  aria-label="Close QR dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>

            <div className="text-center space-y-3 w-full">
              <Dialog.Title className="text-2xl font-bold text-ink tracking-tight">
                {dashboard?.service?.name || 'General OPD'}
              </Dialog.Title>
              <p className="text-sm font-medium text-slate">Scan to join the queue</p>

              <div className="p-4 bg-white rounded-[var(--radius-card)] border border-line inline-block mx-auto shadow-xs">
                <QRCodeSVG
                  value={typeof window !== 'undefined' ? `${window.location.origin}/join/${dashboard?.service?.id || ''}` : ''}
                  size={220}
                  level="H"
                />
              </div>

              <p className="text-[11px] font-mono text-slate break-all select-all no-print">
                {typeof window !== 'undefined' ? `${window.location.origin}/join/${dashboard?.service?.id || ''}` : ''}
              </p>
            </div>

            <div className="mt-5 flex gap-2.5 w-full no-print">
              <Button
                variant="primary"
                className="flex-1 justify-center"
                onClick={() => window.print()}
                aria-label="Print queue poster"
              >
                <Printer className="w-4 h-4 mr-2" aria-hidden="true" />
                <span>Print</span>
              </Button>
              <Dialog.Close asChild>
                <Button variant="secondary" className="flex-1 justify-center">
                  Close
                </Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export default StaffDashboard;
