import React from 'react';
import { usePushNotifications } from '../push/usePushNotifications';

export function PushNotificationCard() {
  const {
    status,
    error,
    isTesting,
    testSuccess,
    enable,
    disable,
    sendTest,
  } = usePushNotifications();

  return (
    <section
      className="card push-notification-card"
      aria-label="Push notifications settings"
      style={{
        padding: '1.25rem',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        backgroundColor: '#ffffff',
        marginBottom: '1.5rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '1.25rem' }}>🔔</span>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
              Get notified even when this page is closed
            </h3>
            {status === 'on' && (
              <span
                style={{
                  backgroundColor: '#c6f6d5',
                  color: '#22543d',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                }}
              >
                Enabled
              </span>
            )}
            {status === 'off' && (
              <span
                style={{
                  backgroundColor: '#edf2f7',
                  color: '#4a5568',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                }}
              >
                Off
              </span>
            )}
            {status === 'blocked' && (
              <span
                style={{
                  backgroundColor: '#fed7d7',
                  color: '#742a2a',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                }}
              >
                Blocked
              </span>
            )}
            {status === 'needs-install' && (
              <span
                style={{
                  backgroundColor: '#feebc8',
                  color: '#7b341e',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                }}
              >
                Add to Home Screen
              </span>
            )}
          </div>

          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', color: '#4a5568', lineHeight: 1.45 }}>
            {status === 'on' &&
              'Web push notifications are active. You will be alerted when your turn is near or your token is called.'}
            {status === 'off' &&
              'Never miss your turn. Enable notifications to receive timely alerts on this device even if you close the browser.'}
            {status === 'needs-install' &&
              'On iOS (iPhone/iPad), Web Push requires adding SmartQueue to your Home Screen: tap the Share button (square with arrow) at the bottom of Safari, then choose "Add to Home Screen".'}
            {status === 'blocked' &&
              'Notifications are blocked in your browser. To unblock: click the site settings / lock icon in your browser address bar and change Notifications to "Allow".'}
            {status === 'unsupported' &&
              'Web Push notifications are not supported in this browser. Please use modern Chrome, Edge, Firefox, or Safari.'}
            {status === 'enabling' && 'Subscribing this device for push notifications...'}
          </p>

          {error && (
            <p
              style={{
                margin: '0.5rem 0 0 0',
                fontSize: '0.825rem',
                color: '#c53030',
                backgroundColor: '#fff5f5',
                padding: '0.35rem 0.6rem',
                borderRadius: '4px',
              }}
            >
              {error}
            </p>
          )}

          {testSuccess && (
            <p
              style={{
                margin: '0.5rem 0 0 0',
                fontSize: '0.825rem',
                color: '#22543d',
                backgroundColor: '#f0fff4',
                padding: '0.35rem 0.6rem',
                borderRadius: '4px',
              }}
            >
              ✓ Test notification sent! Check your notification tray or lock screen.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {status === 'on' && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={sendTest}
                disabled={isTesting}
                aria-label="Send test notification"
              >
                {isTesting ? 'Sending test...' : 'Test push'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={disable}
                aria-label="Disable push notifications"
              >
                Disable
              </button>
            </>
          )}

          {status === 'off' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={enable}
              aria-label="Enable push notifications"
            >
              Enable notifications
            </button>
          )}

          {status === 'enabling' && (
            <button type="button" className="btn btn-secondary btn-sm" disabled>
              Enabling...
            </button>
          )}

          {status === 'error' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={enable}
              aria-label="Retry enabling notifications"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
