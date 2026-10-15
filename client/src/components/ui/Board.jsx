import React from 'react';
import { DotNumber } from './DotNumber';
import { cn } from '../../lib/cn';

export function Board({
  items = [],
  title = 'Now serving',
  emptyText = 'None at the moment',
  className,
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'w-full bg-led-board text-led rounded-[var(--radius-card)] p-3.5 ' +
        'border border-[#22333E] shadow-inner font-sans',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#1A2832] pb-2 mb-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#98A8B3]">
          {title}
        </h3>
        <span className="w-1.5 h-1.5 rounded-full bg-led animate-pulse" aria-hidden="true" />
      </div>

      {(!items || items.length === 0) ? (
        <p className="text-xs text-[#6F828F] py-1">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2.5 sm:gap-4">
          {items.map((item, idx) => (
            <div
              key={item.counterId || idx}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[#0D161C] border border-[#1E2E38]"
            >
              <span className="text-xs font-medium text-[#C2D0D8]">
                {item.counterName || 'Desk'}
              </span>
              <span className="text-led font-dot text-lg font-bold">
                #{item.tokenNumber}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
