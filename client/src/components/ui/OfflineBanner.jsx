import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="bg-coral text-white text-xs py-1.5 px-4 flex items-center justify-center gap-2 select-none shadow-sm z-50 fixed top-0 left-0 right-0"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>You are currently offline. Changes will sync once reconnected.</span>
    </aside>
  );
}
