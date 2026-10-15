import React from 'react';
import { ConnectionPill } from './ConnectionPill';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './Button';
import { LogOut, User } from 'lucide-react';
import { cn } from '../../lib/cn';

export function TopBar({
  user,
  userName,
  roleBadge,
  connectionStatus = 'live',
  onLogout,
  children,
  className,
}) {
  const displayName = userName || (typeof user === 'string' ? user : user?.name);
  return (
    <header
      className={cn(
        'w-full bg-paper-card/90 backdrop-blur-md border-b border-line sticky top-0 z-40 transition-colors',
        className
      )}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-[var(--radius-control)] bg-signal text-white flex items-center justify-center font-bold text-sm shadow-sm"
              aria-hidden="true"
            >
              SQ
            </span>
            <span className="font-semibold text-lg tracking-tight text-ink">
              SmartQueue
            </span>
          </div>
          {roleBadge && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-line-subtle text-ink-secondary border border-line hidden sm:inline-block">
              {roleBadge}
            </span>
          )}
        </div>

        {/* Center / Custom navigation controls if passed */}
        {children && <div className="flex items-center gap-2">{children}</div>}

        {/* Right: Controls & User */}
        <div className="flex items-center gap-2 sm:gap-3">
          <ConnectionPill connectionStatus={connectionStatus} />
          <ThemeToggle />

          {displayName && (
            <div className="flex items-center gap-2 text-xs text-ink-secondary hidden md:flex">
              <User className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-medium text-ink max-w-[140px] truncate">
                {displayName}
              </span>
            </div>
          )}

          {onLogout && (
            <Button
              variant="quiet"
              size="sm"
              onClick={onLogout}
              aria-label="Log out"
              className="text-xs"
            >
              <LogOut className="w-4 h-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
