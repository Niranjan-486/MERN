import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

const STEPS = [
  { id: 'waiting', label: 'Waiting' },
  { id: 'called', label: 'Called' },
  { id: 'serving', label: 'Serving' },
  { id: 'done', label: 'Done' },
];

export function Stepper({ status, className }) {
  const getStepIndex = (s) => {
    switch (s) {
      case 'waiting':
        return 0;
      case 'called':
        return 1;
      case 'serving':
        return 2;
      case 'completed':
      case 'skipped':
      case 'no_show':
      case 'cancelled':
        return 3;
      default:
        return 0;
    }
  };

  const currentIndex = getStepIndex(status);

  return (
    <nav aria-label="Queue progress" className={cn('w-full py-2', className)}>
      <ol className="flex items-center justify-between w-full">
        {STEPS.map((step, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isUpcoming = idx > currentIndex;

          return (
            <li
              key={step.id}
              className="flex-1 flex items-center last:flex-none relative"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors duration-200',
                    isCompleted && 'bg-signal text-white',
                    isCurrent &&
                      (status === 'called'
                        ? 'bg-led text-ink ring-4 ring-led/20'
                        : 'bg-signal text-white ring-4 ring-signal/20'),
                    isUpcoming && 'bg-line-subtle text-slate border border-line'
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    'text-[11px] mt-1.5 font-medium select-none',
                    isCurrent && 'text-ink font-semibold',
                    isCompleted && 'text-signal',
                    isUpcoming && 'text-slate'
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line to next step */}
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-2 -mt-5 transition-colors duration-200',
                    idx < currentIndex ? 'bg-signal' : 'bg-line'
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
