import React from 'react';
import { cn } from '../../lib/cn';

export function DotNumber({
  value,
  prefix = '#',
  className,
  color = 'ink',
  size = 'text-5xl sm:text-6xl',
}) {
  const colorMap = {
    ink: 'text-ink',
    amber: 'text-led',
    signal: 'text-signal',
  };

  return (
    <div
      className={cn('inline-flex items-baseline font-dot select-none', size, colorMap[color], className)}
      aria-label={prefix ? `Token ${prefix}${value}` : `${value}`}
    >
      {prefix && (
        <span className="opacity-70 mr-1 text-[0.8em] font-normal" aria-hidden="true">
          {prefix}
        </span>
      )}
      <span>{value}</span>
    </div>
  );
}
