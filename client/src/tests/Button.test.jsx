import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../components/ui/Button';

describe('Button component', () => {
  test('renders children and responds to click', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    const btn = screen.getByRole('button', { name: /click me/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test('loading state disables button and sets aria-busy', () => {
    const handleClick = vi.fn();
    render(
      <Button loading onClick={handleClick}>
        Submit
      </Button>
    );

    const btn = screen.getByRole('button', { name: /submit/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  test('renders danger variant styling', () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole('button', { name: /delete/i });
    expect(btn.className).toContain('bg-coral');
  });

  test('renders quiet variant styling', () => {
    render(<Button variant="quiet">Cancel</Button>);
    const btn = screen.getByRole('button', { name: /cancel/i });
    expect(btn.className).toContain('text-slate');
  });
});
