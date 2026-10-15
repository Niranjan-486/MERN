import React, { useState, useEffect } from 'react';
import { m } from 'motion/react';
import { DotNumber } from './DotNumber';
import { StatusPill } from './StatusPill';
import { Stepper } from './Stepper';
import { Board } from './Board';
import { Countdown } from './Countdown';
import { RollingNumber } from './RollingNumber';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { formatEta } from '../../lib/formatEta';
import { cn } from '../../lib/cn';

export function Ticket({
  token,
  serviceName,
  nowServingSummary,
  nowServingList = [],
  onCancel,
  onJoinAgain,
  isCancelling = false,
  isNewlyPrinted = false,
  className,
}) {
  const { status, number, peopleAhead, counterName, priority, serviceId } = token;
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Handle "called" title & vibration
  useEffect(() => {
    if (status === 'called') {
      const originalTitle = document.title;
      document.title = 'Your turn!';
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([200, 100, 200]);
        } catch (_) {}
      }
      return () => {
        document.title = originalTitle;
      };
    }
  }, [status]);

  const canCancel = status === 'waiting' || status === 'called';
  const isTerminal = ['completed', 'skipped', 'no_show', 'cancelled'].includes(status);
  const isCalled = status === 'called';
  const isServing = status === 'serving';

  const etaFormatted = formatEta(token.etaSeconds);
  const estimatedWaitText = etaFormatted
    ? etaFormatted === 'less than a minute'
      ? 'less than a minute'
      : `about ${etaFormatted}`
    : null;

  // Print motion animation (slides down from slot with slight overshoot)
  const printVariants = {
    initial: { y: -30, opacity: 0, scale: 0.98 },
    animate: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: { duration: 0.45, ease: [0.34, 1.25, 0.64, 1] },
    },
  };

  return (
    <>
      <m.article
        initial={isNewlyPrinted ? 'initial' : false}
        animate="animate"
        variants={printVariants}
        className={cn(
          'relative w-full rounded-[var(--radius-ticket)] border transition-all duration-300 ' +
          'bg-paper-ticket shadow-md overflow-hidden font-sans',
          isCalled
            ? 'border-led ring-2 ring-led/40 animate-pulse-thrice bg-gradient-to-b from-[#FFFDF8] to-[#FFF9ED] dark:from-[#1A1810] dark:to-[#14120B]'
            : isServing
            ? 'border-signal/50 bg-gradient-to-b from-paper-ticket to-signal-tint/10'
            : isTerminal
            ? 'border-line opacity-85'
            : 'border-line',
          className
        )}
        aria-label={`Token number ${number} status`}
      >
        {/* Ticket Top Stub */}
        <header className="px-5 pt-4 pb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm text-ink truncate">
              {serviceName || 'General OPD'}
            </span>
            {priority > 0 && <StatusPill priority={priority} />}
          </div>
          <StatusPill status={status} />
        </header>

        {/* Notched Perforation Line */}
        <div className="relative flex items-center justify-between w-full h-4 my-0 select-none">
          {/* Left Notch */}
          <div
            className="absolute -left-2.5 w-5 h-5 rounded-full bg-paper border border-line z-10"
            aria-hidden="true"
          />
          {/* Dashed Perforation Line */}
          <div
            className="w-full border-b border-dashed border-line mx-3"
            aria-hidden="true"
          />
          {/* Right Notch */}
          <div
            className="absolute -right-2.5 w-5 h-5 rounded-full bg-paper border border-line z-10"
            aria-hidden="true"
          />
        </div>

        {/* Ticket Main Body */}
        <div className="px-5 pt-3 pb-5 space-y-4">
          {/* Hero Token Number */}
          <div className="flex flex-col items-center justify-center py-2 text-center">
            <DotNumber
              value={number}
              color={isCalled ? 'amber' : isServing ? 'signal' : 'ink'}
              size="text-5xl sm:text-6xl"
            />
          </div>

          {/* Status Message & State Details */}
          <div className="text-center space-y-1.5" aria-live="polite">
            {status === 'waiting' && (
              <>
                <p className="text-sm text-ink">
                  People ahead of you:{' '}
                  <RollingNumber
                    value={peopleAhead ?? 0}
                    className="text-base font-bold text-signal ml-1"
                  />
                </p>
                {estimatedWaitText && (
                  <p className="text-xs text-slate">
                    Estimated wait: <strong className="text-ink font-semibold">{estimatedWaitText}</strong>
                  </p>
                )}
              </>
            )}

            {status === 'called' && (
              <div className="p-3 rounded-[var(--radius-control)] bg-led/15 border border-led/40 text-ink space-y-1">
                <p className="text-base font-bold text-[#945e00] dark:text-led">
                  Your turn! Please go to {counterName || 'assigned counter'}
                </p>
                <Countdown
                  seconds={token.noShowInSec}
                  label="Auto no-show in"
                  className="justify-center"
                />
              </div>
            )}

            {status === 'serving' && (
              <p className="text-sm font-medium text-signal">
                Being served at <strong>{counterName || 'assigned counter'}</strong>
              </p>
            )}

            {status === 'completed' && (
              <p className="text-sm text-signal font-medium">
                Consultation completed. Thank you!
              </p>
            )}

            {status === 'skipped' && (
              <p className="text-sm text-slate">
                You were skipped by the counter staff.
              </p>
            )}

            {status === 'no_show' && (
              <p className="text-sm text-coral font-medium">
                Marked as no-show.
              </p>
            )}

            {status === 'cancelled' && (
              <p className="text-sm text-slate">
                Your token was cancelled.
              </p>
            )}
          </div>

          {/* Stepper Progress */}
          <div className="pt-2 border-t border-line-subtle">
            <Stepper status={status} />
          </div>

          {/* Now Serving Board / Strip */}
          {nowServingList && nowServingList.length > 0 ? (
            <Board items={nowServingList} title="Now serving" />
          ) : (
            <div className="pt-2 text-xs text-slate text-center" aria-live="polite">
              <span>Now serving: </span>
              <span className="font-medium text-ink">
                {nowServingSummary || 'None at the moment'}
              </span>
            </div>
          )}

          {/* Actions Footer */}
          {(canCancel || isTerminal) && (
            <div className="pt-3 flex justify-center">
              {canCancel && onCancel && (
                <Button
                  variant="danger"
                  size="default"
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={isCancelling}
                  aria-label="Cancel Token"
                  className="w-full sm:w-auto"
                >
                  {isCancelling ? 'Cancelling...' : 'Cancel Token'}
                </Button>
              )}

              {isTerminal && onJoinAgain && (
                <Button
                  variant="primary"
                  size="default"
                  onClick={() => onJoinAgain(serviceId)}
                  aria-label="Join again"
                  className="w-full sm:w-auto"
                >
                  Join again
                </Button>
              )}
            </div>
          )}
        </div>
      </m.article>

      {/* Accessible Confirm Dialog for Cancellation */}
      {canCancel && onCancel && (
        <ConfirmDialog
          open={showCancelConfirm}
          onOpenChange={setShowCancelConfirm}
          title="Cancel your queue token?"
          description="If you cancel token #{number}, you will lose your current spot in line and will need to request a new token to rejoin."
          confirmText="Yes, cancel token"
          cancelText="Keep my spot"
          confirmVariant="danger"
          isLoading={isCancelling}
          onConfirm={() => {
            setShowCancelConfirm(false);
            onCancel(token);
          }}
        />
      )}
    </>
  );
}
