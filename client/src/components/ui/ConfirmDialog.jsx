import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './Button';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Keep token',
  onConfirm,
  confirmVariant = 'danger',
  isLoading = false,
  children,
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {children && <Dialog.Trigger asChild>{children}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs transition-opacity duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] bg-paper-card p-6 shadow-xl border border-line focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-control p-1 text-slate hover:text-ink hover:bg-line-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {description && (
            <Dialog.Description className="mt-2.5 text-sm text-slate leading-relaxed">
              {description}
            </Dialog.Description>
          )}

          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={isLoading}>
                {cancelText}
              </Button>
            </Dialog.Close>
            <Button
              variant={confirmVariant}
              onClick={onConfirm}
              loading={isLoading}
            >
              {confirmText}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
