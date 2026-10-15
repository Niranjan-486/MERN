import React from 'react';
import { cn } from '../../lib/cn';

export function ConnectionPill({ connectionStatus = 'live', className }) {
  const isLive = connectionStatus === 'live';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full select-none border transition-colors',
        isLive
          ? 'bg-signal-tint text-signal border-signal/20'
          : 'bg-led/15 text-[#b37400] dark:text-led border-led/30',
        className
      )}
      title={`Socket connection: ${isLive ? 'Connected' : 'Reconnecting'}`}
      role="status"
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full shrink-0',
          isLive ? 'bg-signal animate-live-dot' : 'bg-led animate-pulse'
        )}
        aria-hidden="true"
      />
      <span>{isLive ? 'Live' : 'Reconnecting...'}</span>
    </span>
  );
}
