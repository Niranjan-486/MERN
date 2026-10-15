import React from 'react';
import {
  Clock,
  Bell,
  Activity,
  CheckCircle2,
  SkipForward,
  UserX,
  XCircle,
  AlertTriangle,
  HeartHandshake,
} from 'lucide-react';
import { cn } from '../../lib/cn';

export function StatusPill({ status, priority, className }) {
  if (priority === 2) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-coral-tint text-coral border border-coral/20',
          className
        )}
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Emergency</span>
      </span>
    );
  }

  if (priority === 1) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-signal-tint text-signal border border-signal/20',
          className
        )}
      >
        <HeartHandshake className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Senior</span>
      </span>
    );
  }

  const statusConfig = {
    waiting: {
      label: 'Waiting',
      icon: Clock,
      style: 'bg-paper text-ink-secondary border border-line',
    },
    called: {
      label: 'Called',
      icon: Bell,
      style: 'bg-led/15 text-[#b37400] dark:text-led border border-led/30 font-semibold',
    },
    serving: {
      label: 'Serving',
      icon: Activity,
      style: 'bg-signal-tint text-signal border border-signal/30 font-medium',
    },
    completed: {
      label: 'Completed',
      icon: CheckCircle2,
      style: 'bg-signal-tint/60 text-signal border border-signal/20',
    },
    skipped: {
      label: 'Skipped',
      icon: SkipForward,
      style: 'bg-paper text-slate border border-line',
    },
    no_show: {
      label: 'No Show',
      icon: UserX,
      style: 'bg-coral-tint text-coral border border-coral/20',
    },
    cancelled: {
      label: 'Cancelled',
      icon: XCircle,
      style: 'bg-paper text-slate border border-line',
    },
  };

  const config = statusConfig[status] || {
    label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Status',
    icon: Clock,
    style: 'bg-paper text-ink border border-line',
  };

  const IconComponent = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full select-none',
        config.style,
        className
      )}
    >
      <IconComponent className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}
