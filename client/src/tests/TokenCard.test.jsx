import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenCard } from '../components/TokenCard';

describe('TokenCard Status Rendering', () => {
  const baseToken = {
    tokenId: 'tok-123',
    serviceId: 'svc-456',
    number: 42,
    priority: 0,
    peopleAhead: null,
    counterName: null,
  };

  test('renders status: waiting with people ahead and cancel button', () => {
    const token = {
      ...baseToken,
      status: 'waiting',
      peopleAhead: 5,
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        nowServingSummary="None"
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText(/People ahead of you:/i)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel token/i })).toBeInTheDocument();
  });

  test('renders status: called with prominent banner and changes document.title', () => {
    const token = {
      ...baseToken,
      status: 'called',
      counterName: 'Desk 3',
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        nowServingSummary="Desk 3 (#42)"
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Called')).toBeInTheDocument();
    expect(
      screen.getByText(/Your turn! Please go to Desk 3/i)
    ).toBeInTheDocument();
    expect(document.title).toBe('Your turn!');
    expect(screen.getByRole('button', { name: /cancel token/i })).toBeInTheDocument();
  });

  test('renders status: serving with counter name and no cancel button', () => {
    const token = {
      ...baseToken,
      status: 'serving',
      counterName: 'Desk 1',
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        nowServingSummary="Desk 1 (#42)"
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Serving')).toBeInTheDocument();
    expect(screen.getByText(/Being served at/i)).toBeInTheDocument();
    expect(screen.getByText('Desk 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel token/i })).not.toBeInTheDocument();
  });

  test('renders status: completed with final message and Join again button', () => {
    const token = {
      ...baseToken,
      status: 'completed',
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        onJoinAgain={vi.fn()}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText(/Consultation completed\. Thank you!/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join again/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel token/i })).not.toBeInTheDocument();
  });

  test('renders status: skipped with final message and Join again button', () => {
    const token = {
      ...baseToken,
      status: 'skipped',
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        onJoinAgain={vi.fn()}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByText(/You were skipped by the counter staff\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join again/i })).toBeInTheDocument();
  });

  test('renders status: no_show with final message and Join again button', () => {
    const token = {
      ...baseToken,
      status: 'no_show',
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        onJoinAgain={vi.fn()}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('No Show')).toBeInTheDocument();
    expect(screen.getByText(/Marked as no-show\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join again/i })).toBeInTheDocument();
  });

  test('renders status: cancelled with final message and Join again button', () => {
    const token = {
      ...baseToken,
      status: 'cancelled',
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        onJoinAgain={vi.fn()}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/Your token was cancelled\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join again/i })).toBeInTheDocument();
  });

  test('renders Estimated wait: about N min when etaSeconds is provided', () => {
    const token = {
      ...baseToken,
      status: 'waiting',
      peopleAhead: 2,
      etaSeconds: 300,
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        nowServingSummary="None"
      />
    );

    expect(screen.getByText(/Estimated wait:/i)).toBeInTheDocument();
    expect(screen.getByText(/about 5 min/i)).toBeInTheDocument();
  });

  test('renders Estimated wait: less than a minute when etaSeconds < 60', () => {
    const token = {
      ...baseToken,
      status: 'waiting',
      peopleAhead: 0,
      etaSeconds: 45,
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        nowServingSummary="None"
      />
    );

    expect(screen.getByText(/Estimated wait:/i)).toBeInTheDocument();
    expect(screen.getByText(/less than a minute/i)).toBeInTheDocument();
  });

  test('hides Estimated wait when etaSeconds is null', () => {
    const token = {
      ...baseToken,
      status: 'waiting',
      peopleAhead: 0,
      etaSeconds: null,
    };
    render(
      <TokenCard
        token={token}
        serviceName="General OPD"
        nowServingSummary="None"
      />
    );

    expect(screen.queryByText(/Estimated wait:/i)).not.toBeInTheDocument();
  });
});
