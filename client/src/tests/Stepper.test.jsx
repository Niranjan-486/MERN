import React from 'react';
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stepper } from '../components/ui/Stepper';

describe('Stepper component', () => {
  test('renders all 4 stages', () => {
    render(<Stepper status="waiting" />);

    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('Called')).toBeInTheDocument();
    expect(screen.getByText('Serving')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  test('marks waiting as active when status is waiting', () => {
    const { container } = render(<Stepper status="waiting" />);
    const activeStep = container.querySelector('[aria-current="step"]');
    expect(activeStep).toHaveTextContent('Waiting');
  });

  test('marks called as active when status is called', () => {
    const { container } = render(<Stepper status="called" />);
    const activeStep = container.querySelector('[aria-current="step"]');
    expect(activeStep).toHaveTextContent('Called');
  });

  test('marks serving as active when status is serving', () => {
    const { container } = render(<Stepper status="serving" />);
    const activeStep = container.querySelector('[aria-current="step"]');
    expect(activeStep).toHaveTextContent('Serving');
  });

  test('marks done as active when status is completed', () => {
    const { container } = render(<Stepper status="completed" />);
    const activeStep = container.querySelector('[aria-current="step"]');
    expect(activeStep).toHaveTextContent('Done');
  });
});
