import React, { useState } from 'react';
import { Ticket } from '../components/ui/Ticket';
import { Board } from '../components/ui/Board';
import { Stepper } from '../components/ui/Stepper';
import { DotNumber } from '../components/ui/DotNumber';
import { RollingNumber } from '../components/ui/RollingNumber';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { Countdown } from '../components/ui/Countdown';
import { m } from 'motion/react';
import { PhoneCall, Activity, CheckCircle, SkipForward, Users, Shuffle } from 'lucide-react';

export function DevStates() {
  const [activeTab, setActiveTab] = useState('patient');
  const [rollValue, setRollValue] = useState(5);
  const [waitingList, setWaitingList] = useState([
    { tokenId: 'w1', number: 101, name: 'Alice Smith', priority: 0, eta: 'about 2 min' },
    { tokenId: 'w2', number: 102, name: 'David Lee', priority: 1, eta: 'about 5 min' },
    { tokenId: 'w3', number: 103, name: 'Grace Hopper', priority: 2, eta: 'about 8 min' },
  ]);

  const shuffleQueue = () => {
    setWaitingList((prev) => [...prev].reverse());
  };

  const mockServices = [
    { id: 's1', name: 'General OPD', organizationName: 'City Hospital', waitingCount: 14 },
    { id: 's2', name: 'Pediatrics Clinic', organizationName: 'City Hospital', waitingCount: 3 },
    { id: 's3', name: 'Orthopedics', organizationName: 'City Hospital', waitingCount: 0 },
  ];

  return (
    <div className="min-h-screen bg-paper text-ink pb-20">
      {/* Dev Header */}
      <div className="sticky top-0 z-50 bg-paper/95 backdrop-blur-sm border-b border-line px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded bg-led/20 text-[#995c00] dark:text-led text-xs font-mono font-semibold">
            DEV GALLERY
          </span>
          <span className="text-sm font-semibold text-ink">SmartQueue Fixtures</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-line-subtle rounded-[var(--radius-control)] p-0.5 text-xs">
            {['patient', 'staff', 'tickets', 'components', 'board'].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-[var(--radius-control)] capitalize font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-paper text-ink shadow-xs'
                    : 'text-slate hover:text-ink'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        {/* PATIENT TAB */}
        {activeTab === 'patient' && (
          <div className="space-y-12">
            <section className="space-y-3">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                1. Patient — Empty State (No Token)
              </h2>
              <div className="p-6 rounded-[var(--radius-card)] border border-line bg-paper max-w-xl mx-auto space-y-4">
                <EmptyState
                  title="No active tokens"
                  description="You are not waiting in any queue. Choose a service below to take a token."
                />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                2. Patient — Waiting State (#12, 3 ahead, 10m ETA)
              </h2>
              <div className="max-w-sm mx-auto">
                <Ticket
                  token={{
                    tokenId: 'dev-1',
                    number: 12,
                    status: 'waiting',
                    priority: 0,
                    peopleAhead: 3,
                    etaSeconds: 600,
                  }}
                  serviceName="General OPD"
                  nowServingSummary="Counter 1 (#9)"
                  onCancel={() => alert('Cancel clicked')}
                />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                3. Patient — Called State (Hero Amber, Desk 1, 150s Auto No-Show)
              </h2>
              <div className="max-w-sm mx-auto">
                <Ticket
                  token={{
                    tokenId: 'dev-2',
                    number: 42,
                    status: 'called',
                    priority: 0,
                    counterName: 'Counter 1',
                    noShowInSec: 150,
                  }}
                  serviceName="General OPD"
                  nowServingSummary="Counter 1 (#42)"
                  onCancel={() => alert('Cancel clicked')}
                />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                4. Patient — Serving State (#42 at Counter 1)
              </h2>
              <div className="max-w-sm mx-auto">
                <Ticket
                  token={{
                    tokenId: 'dev-3',
                    number: 42,
                    status: 'serving',
                    priority: 0,
                    counterName: 'Counter 1',
                  }}
                  serviceName="General OPD"
                  nowServingSummary="Counter 1 (#42)"
                />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                5. Patient — Terminal States
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Ticket
                  token={{ tokenId: 'dev-4', number: 7, status: 'completed' }}
                  serviceName="General OPD"
                  onJoinAgain={() => alert('Join again')}
                />
                <Ticket
                  token={{ tokenId: 'dev-5', number: 8, status: 'skipped' }}
                  serviceName="General OPD"
                  onJoinAgain={() => alert('Join again')}
                />
                <Ticket
                  token={{ tokenId: 'dev-6', number: 9, status: 'no_show' }}
                  serviceName="General OPD"
                  onJoinAgain={() => alert('Join again')}
                />
                <Ticket
                  token={{ tokenId: 'dev-7', number: 10, status: 'cancelled' }}
                  serviceName="General OPD"
                  onJoinAgain={() => alert('Join again')}
                />
              </div>
            </section>
          </div>
        )}

        {/* STAFF TAB */}
        {activeTab === 'staff' && (
          <div className="space-y-12">
            {/* 1. Desk Banner with Call Next */}
            <section className="space-y-3">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                1. Desk Overview Banner (Idle, Ready to Call)
              </h2>
              <div className="p-5 rounded-[var(--radius-card)] bg-paper border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-ink">Counter 1</h1>
                  <p className="text-xs text-slate mt-0.5">
                    Service: <strong className="text-ink">General OPD</strong> • Avg service time: 5 min
                  </p>
                </div>
                <Button variant="primary">
                  <PhoneCall className="w-4 h-4 mr-2" aria-hidden="true" />
                  <span>Call Next</span>
                  <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-white/20 rounded">Space</kbd>
                </Button>
              </div>
            </section>

            {/* 2. Now Serving Hero LED Board - Called State */}
            <section className="space-y-3">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                2. Hero LED Board — Called State (Auto No-Show in 150s)
              </h2>
              <div className="max-w-xl mx-auto rounded-[var(--radius-card)] border border-[#22333E] bg-[#0A1318] text-led shadow-md overflow-hidden">
                <div className="p-4 border-b border-[#1A2630] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-led animate-pulse" aria-hidden="true" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#A0B0BA]">
                      Current Consultation
                    </span>
                  </div>
                  <StatusPill status="called" />
                </div>
                <div className="p-6 text-center space-y-4">
                  <DotNumber number={42} className="text-7xl font-bold text-led drop-shadow-[0_0_12px_rgba(255,178,36,0.35)]" />
                  <p className="text-base text-white/95">
                    Patient: <strong className="text-white">Jane Doe</strong>
                  </p>
                  <Countdown seconds={150} className="text-led font-semibold" />
                  <div className="pt-2 flex justify-center gap-3">
                    <Button variant="primary">
                      <Activity className="w-4 h-4 mr-1.5" aria-hidden="true" />
                      <span>Start Serving</span>
                      <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-white/20 rounded">Enter</kbd>
                    </Button>
                    <Button variant="secondary" className="text-slate hover:text-coral">
                      <SkipForward className="w-4 h-4 mr-1.5" aria-hidden="true" />
                      <span>Skip</span>
                      <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-line-subtle text-slate rounded">K</kbd>
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. Waiting Queue with Motion Layout Animation */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                  3. Waiting Queue (Motion Spring Layout Animation)
                </h2>
                <Button size="sm" variant="secondary" onClick={shuffleQueue}>
                  <Shuffle className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                  <span>Reorder queue</span>
                </Button>
              </div>

              <div className="rounded-[var(--radius-card)] bg-paper border border-line overflow-hidden max-w-xl mx-auto">
                <m.ul className="divide-y divide-line">
                  {waitingList.map((t, idx) => (
                    <m.li
                      key={t.tokenId}
                      layout
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      className="p-3.5 flex items-center justify-between gap-3 bg-paper"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-slate w-5">#{idx + 1}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <strong className="text-sm font-bold text-ink">#{t.number}</strong>
                            {t.priority > 0 && <StatusPill priority={t.priority} />}
                          </div>
                          <p className="text-xs text-slate">{t.name}</p>
                        </div>
                      </div>
                      <span className="text-xs text-slate font-medium">{t.eta}</span>
                    </m.li>
                  ))}
                </m.ul>
              </div>
            </section>
          </div>
        )}

        {/* TICKETS TAB */}
        {activeTab === 'tickets' && (
          <div className="space-y-8">
            <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
              Priority Tickets (Senior & Emergency)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <Ticket
                token={{
                  tokenId: 'dev-p1',
                  number: 101,
                  status: 'waiting',
                  priority: 1, // Senior
                  peopleAhead: 1,
                  etaSeconds: 180,
                }}
                serviceName="General OPD"
                nowServingSummary="Counter 1 (#100)"
                onCancel={() => {}}
              />
              <Ticket
                token={{
                  tokenId: 'dev-p2',
                  number: 999,
                  status: 'waiting',
                  priority: 2, // Emergency
                  peopleAhead: 0,
                  etaSeconds: 30,
                }}
                serviceName="Emergency Care"
                nowServingSummary="None"
                onCancel={() => {}}
              />
            </div>
          </div>
        )}

        {/* BOARD TAB */}
        {activeTab === 'board' && (
          <div className="space-y-8">
            <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
              Now Serving Board (LED Amber Dot-Matrix Display)
            </h2>
            <div className="max-w-md mx-auto space-y-4">
              <Board
                counterName="Counter 1"
                tokenNumber={42}
                serviceName="General OPD"
                status="calling"
              />
              <Board
                counterName="Counter 1"
                tokenNumber={null}
                serviceName="General OPD"
                status="idle"
              />
            </div>
          </div>
        )}

        {/* COMPONENTS TAB */}
        {activeTab === 'components' && (
          <div className="space-y-10">
            {/* Dot Number & Rolling Number */}
            <section className="space-y-4">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                Typography: Doto Dot-Matrix (≥40px) & Rolling Numbers
              </h2>
              <div className="p-6 rounded-[var(--radius-card)] border border-line bg-paper space-y-4">
                <div className="flex items-center gap-8">
                  <div>
                    <span className="text-xs text-slate block mb-1">DotNumber display</span>
                    <DotNumber number={42} className="text-5xl text-signal" />
                  </div>
                  <div>
                    <span className="text-xs text-slate block mb-1">LED Amber DotNumber</span>
                    <DotNumber number={88} className="text-5xl text-led" />
                  </div>
                  <div>
                    <span className="text-xs text-slate block mb-1">RollingNumber</span>
                    <div className="flex items-center gap-2">
                      <RollingNumber value={rollValue} className="text-3xl text-signal" />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRollValue((v) => (v >= 10 ? 1 : v + 1))}
                      >
                        Roll (+1)
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Stepper */}
            <section className="space-y-4">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                Queue Progress Stepper
              </h2>
              <div className="p-6 rounded-[var(--radius-card)] border border-line bg-paper space-y-6">
                <div>
                  <span className="text-xs text-slate block mb-2">Stage 1: Waiting</span>
                  <Stepper status="waiting" />
                </div>
                <div>
                  <span className="text-xs text-slate block mb-2">Stage 2: Called</span>
                  <Stepper status="called" />
                </div>
                <div>
                  <span className="text-xs text-slate block mb-2">Stage 3: Serving</span>
                  <Stepper status="serving" />
                </div>
                <div>
                  <span className="text-xs text-slate block mb-2">Stage 4: Done</span>
                  <Stepper status="completed" />
                </div>
              </div>
            </section>

            {/* Buttons & Status Pills */}
            <section className="space-y-4">
              <h2 className="text-sm font-mono uppercase text-slate tracking-wider">
                Buttons & Status Pills
              </h2>
              <div className="p-6 rounded-[var(--radius-card)] border border-line bg-paper space-y-6">
                <div className="flex flex-wrap gap-3 items-center">
                  <Button variant="primary">Primary button</Button>
                  <Button variant="secondary">Secondary button</Button>
                  <Button variant="quiet">Quiet button</Button>
                  <Button variant="danger">Danger button</Button>
                  <Button variant="primary" loading>
                    Loading state
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  <StatusPill status="waiting" />
                  <StatusPill status="called" />
                  <StatusPill status="serving" />
                  <StatusPill status="completed" />
                  <StatusPill status="skipped" />
                  <StatusPill status="no_show" />
                  <StatusPill status="cancelled" />
                  <StatusPill priority={1} />
                  <StatusPill priority={2} />
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default DevStates;
