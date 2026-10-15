import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

describe('ConfirmDialog component', () => {
  test('renders dialog content when open', () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Cancel this token?"
        description="You will lose your place in queue."
        confirmText="Cancel token"
        cancelText="Keep token"
      />
    );

    expect(screen.getByText('Cancel this token?')).toBeInTheDocument();
    expect(screen.getByText('You will lose your place in queue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel token/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep token/i })).toBeInTheDocument();
  });

  test('calls onConfirm when confirm button is clicked', () => {
    const handleConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Confirm action"
        confirmText="Confirm"
        onConfirm={handleConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  test('calls onOpenChange(false) when Escape is pressed', () => {
    const handleOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={handleOpenChange}
        title="Escape test"
      />
    );

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });
});
