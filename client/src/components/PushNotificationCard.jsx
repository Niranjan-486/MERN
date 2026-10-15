import React, { useState } from 'react';
import { Bell, BellOff, BellRing, Share, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { usePushNotifications } from '../push/usePushNotifications';
import { Button } from './ui/Button';
import { cn } from '../lib/cn';

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

  const [dismissed, setDismissed] = useState(false);

  // If dismissed by user in this session (unless there's an active error or testSuccess)
  if (dismissed && !error && !testSuccess) return null;

  return (
    <section
      className="mb-6 p-4 rounded-[var(--radius-card)] bg-paper border border-line text-ink transition-colors duration-200"
      aria-label="Push notifications settings"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5',
              status === 'on' ? 'bg-signal-tint text-signal' : 'bg-line-subtle text-slate'
            )}
            aria-hidden="true"
          >
            {status === 'on' ? (
              <BellRing className="w-4 h-4" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-ink leading-tight">
                {status === 'on' ? 'Notifications active' : 'Get notified when your turn is near'}
              </h3>
              {status === 'on' && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-signal-tint text-signal">
                  Enabled
                </span>
              )}
              {status === 'needs-install' && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-led/20 text-[#995c00] dark:text-led">
                  Install required
                </span>
              )}
            </div>

            <div className="text-xs text-slate leading-relaxed">
              {status === 'on' && (
                <p>We will alert your phone when your turn is near or your token is called.</p>
              )}
              {status === 'off' && (
                <p>Step away from the clinic with confidence. We’ll notify you when it’s time to head to the counter.</p>
              )}
              {status === 'needs-install' && (
                <div className="mt-1 space-y-1 text-slate">
                  <p>On iOS, push alerts require adding the app to your Home Screen:</p>
                  <ol className="list-decimal list-inside space-y-0.5 font-medium text-ink">
                    <li>Tap the Share button in Safari</li>
                    <li>Select "Add to Home Screen"</li>
                    <li>Open SmartQueue from your Home Screen</li>
                  </ol>
                </div>
              )}
              {status === 'blocked' && (
                <p className="text-coral">
                  Notifications are blocked in your browser. Click the lock or site settings icon in your address bar and change Notifications to "Allow".
                </p>
              )}
              {status === 'unsupported' && (
                <p>Push alerts are not supported by this browser. Keep this tab open to monitor your position.</p>
              )}
              {status === 'enabling' && <p>Subscribing device for notifications...</p>}
            </div>

            {error && (
              <div
                className="mt-2 text-xs text-coral bg-coral-tint p-2 rounded-[var(--radius-control)] border border-coral/20 flex items-center gap-1.5"
                role="alert"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {testSuccess && (
              <div
                className="mt-2 text-xs text-signal bg-signal-tint p-2 rounded-[var(--radius-control)] border border-signal/20 flex items-center gap-1.5"
                role="status"
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Test notification sent. Check your device notifications.</span>
              </div>
            )}
          </div>
        </div>

        {/* Right action / close */}
        <div className="flex items-center gap-2 shrink-0">
          {status === 'on' && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={sendTest}
                disabled={isTesting}
                loading={isTesting}
                aria-label="Send test notification"
              >
                Test push
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={disable}
                aria-label="Disable push notifications"
              >
                Disable
              </Button>
            </div>
          )}

          {status === 'off' && (
            <Button
              variant="primary"
              size="sm"
              onClick={enable}
              aria-label="Enable push notifications"
            >
              Enable
            </Button>
          )}

          {status === 'error' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={enable}
              aria-label="Retry enabling notifications"
            >
              Retry
            </Button>
          )}

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1 rounded text-slate hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal"
            aria-label="Dismiss notification card"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

export default PushNotificationCard;
