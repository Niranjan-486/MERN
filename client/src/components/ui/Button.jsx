import React from 'react';
import { cn } from '../../lib/cn';

export const Button = React.forwardRef(function Button(
  {
    children,
    type = 'button',
    variant = 'primary',
    size = 'default',
    isLoading = false,
    loading = false,
    loadingText,
    disabled = false,
    className,
    onClick,
    ...props
  },
  ref
) {
  const isBusy = isLoading || loading;

  const baseClasses =
    'inline-flex items-center justify-center font-medium select-none cursor-pointer ' +
    'transition-colors duration-150 active:scale-[0.98] disabled:active:scale-100 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2';

  const variants = {
    primary: 'bg-signal text-white hover:bg-signal-hover shadow-sm border border-transparent',
    secondary: 'bg-transparent text-ink border border-line hover:bg-line-subtle',
    quiet: 'bg-transparent text-slate hover:text-ink hover:bg-line-subtle border-0',
    danger: 'bg-coral text-white hover:opacity-90 shadow-sm border border-transparent',
  };

  const sizes = {
    default: 'min-h-[48px] px-5 py-2.5 text-[15px] rounded-[var(--radius-control)]',
    sm: 'min-h-[40px] px-3.5 py-1.5 text-[13px] rounded-[var(--radius-control)]',
    lg: 'min-h-[56px] px-6 py-3 text-[16px] font-semibold rounded-[var(--radius-control)]',
  };

  const isDisabled = disabled || isBusy;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={isBusy}
      onClick={onClick}
      className={cn(baseClasses, variants[variant], sizes[size], className)}
      {...props}
    >
      {isBusy ? (
        <span className="inline-flex items-center gap-2">
          <svg
            className="animate-spin h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>{loadingText || children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
});
