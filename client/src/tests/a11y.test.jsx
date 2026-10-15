import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { Login } from '../pages/Login';
import { Ticket } from '../components/ui/Ticket';
import { Stepper } from '../components/ui/Stepper';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Board } from '../components/ui/Board';

describe('Accessibility audits (WCAG AA)', () => {
  test('Login screen has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('Ticket waiting state has no axe violations', async () => {
    const { container } = render(
      <Ticket
        token={{
          tokenId: 't1',
          number: 12,
          status: 'waiting',
          priority: 0,
          peopleAhead: 3,
          etaSeconds: 300,
        }}
        serviceName="General OPD"
        nowServingSummary="Desk 1 (#10)"
        onCancel={vi.fn()}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('Ticket called state has no axe violations', async () => {
    const { container } = render(
      <Ticket
        token={{
          tokenId: 't2',
          number: 15,
          status: 'called',
          priority: 0,
          counterName: 'Desk 1',
          noShowInSec: 120,
        }}
        serviceName="General OPD"
        nowServingSummary="Desk 1 (#15)"
        onCancel={vi.fn()}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('Stepper has no axe violations', async () => {
    const { container } = render(<Stepper status="called" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('EmptyState and ErrorState have no axe violations', async () => {
    const { container } = render(
      <div>
        <EmptyState title="No items" description="Nothing here yet" />
        <ErrorState title="Error" message="Something broke" />
      </div>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('Board component has no axe violations', async () => {
    const { container } = render(
      <Board
        title="Now serving"
        items={[
          { counterName: 'Counter 1', tokenNumber: 42 },
          { counterName: 'Counter 2', tokenNumber: 43 },
        ]}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
