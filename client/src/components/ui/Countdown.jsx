import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { formatCountdown } from '../../lib/formatCountdown';
import { cn } from '../../lib/cn';

export function Countdown({
  seconds: initialSeconds,
  label = 'Auto no-show in',
  className,
}) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    setSeconds(initialSeconds);
    if (initialSeconds == null) return;

    const interval = setInterval(() => {
      setSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [initialSeconds]);

  if (seconds == null) return null;

  const isUrgent = seconds < 60;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium tabular-nums',
        isUrgent ? 'text-coral' : 'text-ink-secondary',
        className
      )}
    >
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      <strong className={cn('font-semibold', isUrgent && 'text-coral')}>
        {formatCountdown(seconds)}
      </strong>
    </div>
  );
}
