import React, { useEffect, useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/cn';

function DigitRoll({ digit }) {
  const num = parseInt(digit, 10);
  if (isNaN(num)) {
    return <span aria-hidden="true">{digit}</span>;
  }

  return (
    <span
      className="relative inline-block overflow-hidden h-[1.25em] align-middle"
      aria-hidden="true"
    >
      <m.span
        key={digit}
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: '0%', opacity: 1 }}
        exit={{ y: '-100%', opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
        className="block"
      >
        {digit}
      </m.span>
    </span>
  );
}

export function RollingNumber({ value, className, prefix = '', suffix = '', reducedMotion }) {
  const motionReduced = useReducedMotion();
  const shouldReduceMotion = reducedMotion !== undefined ? reducedMotion : motionReduced;
  const stringValue = String(value ?? 0);

  if (shouldReduceMotion) {
    return (
      <span
        className={cn('inline-flex items-baseline font-semibold tabular-nums', className)}
        aria-live="polite"
      >
        {prefix}{stringValue}{suffix}
      </span>
    );
  }

  const chars = stringValue.split('');

  return (
    <span
      className={cn('inline-flex items-baseline font-semibold tabular-nums', className)}
      aria-live="polite"
    >
      <span className="sr-only">
        {prefix}{stringValue}{suffix}
      </span>
      <span aria-hidden="true" className="inline-flex items-center">
        {prefix && <span>{prefix}</span>}
        {chars.map((char, index) => (
          <DigitRoll key={`${index}-${char}`} digit={char} />
        ))}
        {suffix && <span>{suffix}</span>}
      </span>
    </span>
  );
}
