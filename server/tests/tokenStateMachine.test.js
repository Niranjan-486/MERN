const {
  STATUSES,
  ACTIVE_STATUSES,
  COUNTER_HOLDING_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  canTransition,
  assertTransition,
  isActiveStatus,
  isHoldingCounterStatus,
} = require('../src/services/tokenStateMachine');

// ───── canTransition ─────

describe('canTransition', () => {
  // Every allowed transition should return true
  const allowedCases = [
    ['waiting', 'called'],
    ['waiting', 'cancelled'],
    ['called', 'serving'],
    ['called', 'skipped'],
    ['called', 'no_show'],
    ['called', 'cancelled'],
    ['serving', 'completed'],
  ];

  test.each(allowedCases)('%s -> %s should be allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // Illegal transitions should return false
  const illegalCases = [
    ['waiting', 'serving'],      // must be called first
    ['waiting', 'completed'],    // can't jump to completed
    ['called', 'waiting'],       // no going back
    ['serving', 'waiting'],      // no going back
    ['serving', 'called'],       // no going back
    ['serving', 'skipped'],      // can only complete from serving
    ['completed', 'waiting'],    // terminal
    ['skipped', 'waiting'],      // terminal
    ['no_show', 'called'],       // terminal
    ['cancelled', 'waiting'],    // terminal
  ];

  test.each(illegalCases)('%s -> %s should be illegal', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  test('unknown source status returns false', () => {
    expect(canTransition('nonexistent', 'waiting')).toBe(false);
  });
});

// ───── assertTransition ─────

describe('assertTransition', () => {
  test('does not throw for allowed transitions', () => {
    expect(() => assertTransition('waiting', 'called')).not.toThrow();
    expect(() => assertTransition('called', 'serving')).not.toThrow();
    expect(() => assertTransition('serving', 'completed')).not.toThrow();
  });

  test('throws for illegal transition with descriptive message', () => {
    expect(() => assertTransition('waiting', 'serving')).toThrow(
      /Illegal transition: "waiting" -> "serving"/
    );
  });

  test('error message lists allowed transitions', () => {
    expect(() => assertTransition('waiting', 'completed')).toThrow(
      /Allowed transitions from "waiting": called, cancelled/
    );
  });

  test('error message notes terminal status', () => {
    expect(() => assertTransition('completed', 'waiting')).toThrow(
      /terminal status/
    );
  });

  test('throws for unknown source status', () => {
    expect(() => assertTransition('bogus', 'waiting')).toThrow(
      /Unknown token status: "bogus"/
    );
  });

  test('throws for unknown target status', () => {
    expect(() => assertTransition('waiting', 'bogus')).toThrow(
      /Unknown token status: "bogus"/
    );
  });
});

// ───── isActiveStatus ─────

describe('isActiveStatus', () => {
  test.each(ACTIVE_STATUSES)('%s is active', (status) => {
    expect(isActiveStatus(status)).toBe(true);
  });

  test.each(TERMINAL_STATUSES)('%s is not active', (status) => {
    expect(isActiveStatus(status)).toBe(false);
  });
});

// ───── isHoldingCounterStatus ─────

describe('isHoldingCounterStatus', () => {
  test.each(COUNTER_HOLDING_STATUSES)('%s holds a counter', (status) => {
    expect(isHoldingCounterStatus(status)).toBe(true);
  });

  const nonHoldingStatuses = ['waiting', 'completed', 'skipped', 'no_show', 'cancelled'];
  test.each(nonHoldingStatuses)('%s does not hold a counter', (status) => {
    expect(isHoldingCounterStatus(status)).toBe(false);
  });
});

// ───── TRANSITIONS map completeness ─────

describe('TRANSITIONS map', () => {
  test('every status has an entry in the transitions map', () => {
    for (const status of Object.values(STATUSES)) {
      expect(TRANSITIONS).toHaveProperty(status);
    }
  });

  test('terminal statuses have empty transition arrays', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(TRANSITIONS[status]).toEqual([]);
    }
  });
});
