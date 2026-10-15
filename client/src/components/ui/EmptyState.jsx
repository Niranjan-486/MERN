import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/cn';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}) {
  return (
    <div
      className={cn(
        'w-full py-10 px-6 rounded-[var(--radius-card)] border border-dashed border-line ' +
        'bg-paper-card/50 flex flex-col items-center justify-center text-center',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-line-subtle flex items-center justify-center text-ink-secondary mb-3">
        <Icon className="w-6 h-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-slate max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
