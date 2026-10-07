import React, { useEffect } from 'react';

/**
 * TokenCard: renders the current state of a patient's token.
 * Handles all 7 token states:
 * - waiting: "People ahead of you: N"
 * - called: "Your turn! Please go to <counterName>" + title update & vibration
 * - serving: "Being served at <counterName>"
 * - completed / skipped / no_show / cancelled: short final message + "Join again" button
 */
export function TokenCard({
  token,
  serviceName,
  nowServingSummary,
  onCancel,
  onJoinAgain,
  isCancelling = false,
}) {
  const { status, number, peopleAhead, counterName, priority, serviceId } = token;

  // Handle "called" title & vibration
  useEffect(() => {
    if (status === 'called') {
      const originalTitle = document.title;
      document.title = 'Your turn!';
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(200);
        } catch (_) {}
      }
      return () => {
        document.title = originalTitle;
      };
    }
  }, [status]);

  const canCancel = status === 'waiting' || status === 'called';
  const isTerminal = ['completed', 'skipped', 'no_show', 'cancelled'].includes(status);

  const getStatusBadgeClass = () => {
    switch (status) {
      case 'waiting':
        return 'badge badge-waiting';
      case 'called':
        return 'badge badge-called';
      case 'serving':
        return 'badge badge-serving';
      case 'completed':
        return 'badge badge-completed';
      case 'cancelled':
      case 'skipped':
      case 'no_show':
        return 'badge badge-terminal';
      default:
        return 'badge';
    }
  };

  const formatStatusName = (s) => {
    if (s === 'no_show') return 'No Show';
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  return (
    <article className={`token-card token-${status}`} aria-label={`Token number ${number} status`}>
      <header className="token-header">
        <div className="token-meta">
          <span className="token-service-name">{serviceName || 'Service'}</span>
          {priority === 1 && <span className="priority-tag senior">Senior Citizen</span>}
          {priority === 2 && <span className="priority-tag emergency">Emergency</span>}
        </div>
        <span className={getStatusBadgeClass()}>{formatStatusName(status)}</span>
      </header>

      <div className="token-body">
        <div className="token-number-display">
          <span className="token-hash">#</span>
          <span className="token-number">{number}</span>
        </div>

        {/* Live status message with polite screen reader announcement */}
        <div className="token-status-message" aria-live="polite">
          {status === 'waiting' && (
            <p className="status-text waiting-text">
              People ahead of you: <strong>{peopleAhead ?? 0}</strong>
            </p>
          )}

          {status === 'called' && (
            <aside className="called-banner" role="alert">
              <strong>Your turn! Please go to {counterName || 'assigned counter'}</strong>
            </aside>
          )}

          {status === 'serving' && (
            <p className="status-text serving-text">
              Being served at <strong>{counterName || 'assigned counter'}</strong>
            </p>
          )}

          {status === 'completed' && (
            <p className="status-text terminal-text">Consultation completed. Thank you!</p>
          )}

          {status === 'skipped' && (
            <p className="status-text terminal-text">You were skipped by the counter staff.</p>
          )}

          {status === 'no_show' && (
            <p className="status-text terminal-text">Marked as no-show.</p>
          )}

          {status === 'cancelled' && (
            <p className="status-text terminal-text">Your token was cancelled.</p>
          )}
        </div>

        {/* Now Serving info from queue:updated */}
        <div className="token-now-serving" aria-live="polite">
          <span className="now-serving-label">Now serving: </span>
          <span className="now-serving-value">{nowServingSummary || 'None at the moment'}</span>
        </div>
      </div>

      <footer className="token-actions">
        {canCancel && onCancel && (
          <button
            type="button"
            className="btn btn-danger btn-cancel"
            onClick={() => onCancel(token)}
            disabled={isCancelling}
            aria-label="Cancel Token"
          >
            {isCancelling ? 'Cancelling...' : 'Cancel Token'}
          </button>
        )}

        {isTerminal && onJoinAgain && (
          <button
            type="button"
            className="btn btn-primary btn-join-again"
            onClick={() => onJoinAgain(serviceId)}
            aria-label="Join again"
          >
            Join again
          </button>
        )}
      </footer>
    </article>
  );
}
