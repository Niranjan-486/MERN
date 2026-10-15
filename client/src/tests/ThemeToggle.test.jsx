import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '../components/ui/ThemeToggle';

describe('ThemeToggle component', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  test('cycles theme from system to light to dark, persisting in localStorage', () => {
    render(<ThemeToggle />);

    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-label', 'Theme: System theme. Click to change theme.');

    // Click 1: light
    fireEvent.click(btn);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(btn).toHaveAttribute('aria-label', 'Theme: Light theme. Click to change theme.');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Click 2: dark
    fireEvent.click(btn);
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(btn).toHaveAttribute('aria-label', 'Theme: Dark theme. Click to change theme.');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // Click 3: system
    fireEvent.click(btn);
    expect(localStorage.getItem('theme')).toBe('system');
    expect(btn).toHaveAttribute('aria-label', 'Theme: System theme. Click to change theme.');
  });
});
