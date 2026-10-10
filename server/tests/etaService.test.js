const { computeEtas } = require('../src/services/etaService');

describe('Pure ETA Simulation Service (computeEtas)', () => {
  const DEFAULT_AVG = 300;

  // Test Case 1: 1 idle counter, 3 waiting -> [0, 300, 600]
  test('1 idle counter, 3 waiting -> [0, 300, 600]', () => {
    const etas = computeEtas({
      now: 1000,
      waiting: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
      counters: [{ status: 'active', currentToken: null }],
      avgServiceSec: DEFAULT_AVG,
    });
    expect(etas).toEqual([0, 300, 600]);
  });

  // Test Case 2: 1 counter 100 s into a serving token, 2 waiting -> [200, 500]
  test('1 counter 100 s into a serving token, 2 waiting -> [200, 500]', () => {
    const now = 1000;
    const servingAt = 900; // 100 seconds elapsed
    const etas = computeEtas({
      now,
      waiting: [{ id: 'w1' }, { id: 'w2' }],
      counters: [
        {
          status: 'active',
          currentToken: { status: 'serving', servingAt },
        },
      ],
      avgServiceSec: DEFAULT_AVG,
    });
    expect(etas).toEqual([200, 500]);
  });

  // Test Case 3: 2 idle counters, 5 waiting -> [0, 0, 300, 300, 600]
  test('2 idle counters, 5 waiting -> [0, 0, 300, 300, 600]', () => {
    const etas = computeEtas({
      now: 0,
      waiting: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w4' }, { id: 'w5' }],
      counters: [
        { status: 'active', currentToken: null },
        { status: 'active', currentToken: null },
      ],
      avgServiceSec: DEFAULT_AVG,
    });
    expect(etas).toEqual([0, 0, 300, 300, 600]);
  });

  // Test Case 4: serving token already 900 s old, 2 waiting -> [30, 330]
  test('serving token already 900 s old, 2 waiting -> [30, 330]', () => {
    const now = 2000;
    const servingAt = 1100; // 900s elapsed into 300s avg -> floor at 30s
    const etas = computeEtas({
      now,
      waiting: [{ id: 'w1' }, { id: 'w2' }],
      counters: [
        {
          status: 'active',
          currentToken: { status: 'serving', servingAt },
        },
      ],
      avgServiceSec: DEFAULT_AVG,
    });
    expect(etas).toEqual([30, 330]);
  });

  // Test Case 5: a called token on the only counter, 2 waiting -> [300, 600]
  test('a called token on the only counter, 2 waiting -> [300, 600]', () => {
    const etas = computeEtas({
      now: 500,
      waiting: [{ id: 'w1' }, { id: 'w2' }],
      counters: [
        {
          status: 'active',
          currentToken: { status: 'called' },
        },
      ],
      avgServiceSec: DEFAULT_AVG,
    });
    expect(etas).toEqual([300, 600]);
  });

  // Test Case 6: no active counters -> [null, null]
  test('no active counters -> [null, null]', () => {
    const etas = computeEtas({
      now: 0,
      waiting: [{ id: 'w1' }, { id: 'w2' }],
      counters: [
        { status: 'offline', currentToken: null },
        { status: 'paused', currentToken: null },
      ],
      avgServiceSec: DEFAULT_AVG,
    });
    expect(etas).toEqual([null, null]);
  });

  // Test Case 7: a paused counter holding a serving token is ignored
  test('a paused counter holding a serving token is ignored', () => {
    const etas = computeEtas({
      now: 0,
      waiting: [{ id: 'w1' }],
      counters: [
        {
          status: 'paused',
          currentToken: { status: 'serving', servingAt: 0 },
        },
        {
          status: 'active',
          currentToken: null,
        },
      ],
      avgServiceSec: DEFAULT_AVG,
    });
    // Active idle counter handles waiting token immediately
    expect(etas).toEqual([0]);
  });

  // Test Case 8: ETAs never decrease along the list
  test('ETAs never decrease along the list for complex multi-counter setups', () => {
    const now = 1000;
    const counters = [
      { status: 'active', currentToken: null }, // free now (1000)
      { status: 'active', currentToken: { status: 'called' } }, // free at 1300
      { status: 'active', currentToken: { status: 'serving', servingAt: 800 } }, // 200s in, free at 1100
      { status: 'paused', currentToken: null }, // ignored
      { status: 'offline', currentToken: null }, // ignored
    ];
    const waiting = Array.from({ length: 15 }, (_, i) => ({ id: `token-${i}` }));

    const etas = computeEtas({
      now,
      waiting,
      counters,
      avgServiceSec: DEFAULT_AVG,
    });

    expect(etas).toHaveLength(15);
    for (let i = 1; i < etas.length; i++) {
      expect(etas[i]).toBeGreaterThanOrEqual(etas[i - 1]);
    }
  });

  test('handles empty waiting array gracefully', () => {
    const etas = computeEtas({
      now: 0,
      waiting: [],
      counters: [{ status: 'active', currentToken: null }],
    });
    expect(etas).toEqual([]);
  });

  test('handles Date objects for now and servingAt', () => {
    const base = new Date('2026-10-10T10:00:00Z');
    const servingAt = new Date('2026-10-10T09:58:20Z'); // 100s ago
    const etas = computeEtas({
      now: base,
      waiting: [{ id: 'w1' }],
      counters: [
        {
          status: 'active',
          currentToken: { status: 'serving', servingAt },
        },
      ],
      avgServiceSec: 300,
    });
    expect(etas).toEqual([200]);
  });

  test('supports custom avgServiceSec (e.g. 180s / 3 min)', () => {
    const etas = computeEtas({
      now: 0,
      waiting: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
      counters: [{ status: 'active', currentToken: null }],
      avgServiceSec: 180,
    });
    expect(etas).toEqual([0, 180, 360]);
  });
});
