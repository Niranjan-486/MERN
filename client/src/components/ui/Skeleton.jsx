import React from 'react';
import { cn } from '../../lib/cn';

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-line-subtle dark:bg-line/40',
        className
      )}
      {...props}
    />
  );
}
