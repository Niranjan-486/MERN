import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RollingNumber } from '../components/ui/RollingNumber';
import * as motionReact from 'motion/react';

describe('RollingNumber component', () => {
  test('announces final value via aria-live polite', () => {
    const { container } = render(<RollingNumber value={42} />);

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();

    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toHaveTextContent('42');
  });

  test('renders with prefix and suffix', () => {
    const { container } = render(<RollingNumber value={5} prefix="#" suffix=" min" />);

    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toHaveTextContent('#5 min');
  });

  test('renders final value immediately under reduced motion', () => {
    const { container } = render(<RollingNumber value={99} reducedMotion={true} />);
    const liveRegion = container.querySelector('[aria-live="polite"]');

    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent('99');
    expect(container.querySelector('.sr-only')).toBeNull();
  });
});
