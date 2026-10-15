import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/cn';

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'w-full p-4 rounded-[var(--radius-control)] border border-coral/30 ' +
        'bg-coral-tint text-coral flex items-start gap-3',
        className
      )}
    >
      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-coral" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-coral leading-snug">{title}</h4>
        {message && (
          <p className="mt-1 text-xs text-coral/90 leading-relaxed">{message}</p>
        )}
      </div>
      {onRetry && (
        <Button
          variant="quiet"
          size="sm"
          onClick={onRetry}
          className="shrink-0 text-coral hover:bg-coral/10 hover:text-coral h-8 px-2.5 text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
