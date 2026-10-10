const { createSingleFlightByKey } = require('../../src/utils/singleFlightByKey');

describe('singleFlightByKey utility', () => {
  test('bursts coalesce: multiple rapid schedules result in at most one subsequent rerun', async () => {
    let callCount = 0;
    const processedBatches = [];

    const flight = createSingleFlightByKey(async (key, entry) => {
      callCount += 1;
      const items = Array.from(entry.items);
      entry.items.clear();
      processedBatches.push(items);
      // Simulate asynchronous execution time
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Schedule initial run
    flight.schedule('service1:today', 'item-1');

    // While initial run is in-flight, burst 10 additional schedules
    for (let i = 2; i <= 10; i++) {
      flight.schedule('service1:today', `item-${i}`);
    }

    // Wait for initial run + coalesced rerun to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Must have executed exactly 2 times: the initial run, and 1 coalesced rerun
    expect(callCount).toBe(2);
    expect(processedBatches[0]).toEqual(['item-1']);
    expect(processedBatches[1]).toEqual([
      'item-2',
      'item-3',
      'item-4',
      'item-5',
      'item-6',
      'item-7',
      'item-8',
      'item-9',
      'item-10',
    ]);
    expect(flight.isRunning('service1:today')).toBe(false);
  });

  test('a run that throws never wedges its key', async () => {
    let attempts = 0;
    const errorsCaught = [];

    const flight = createSingleFlightByKey(
      async (key) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Simulated transient failure');
        }
      },
      {
        onError: (err, key) => {
          errorsCaught.push({ key, message: err.message });
        },
      }
    );

    // Run 1: will throw
    flight.schedule('service-flaky');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(attempts).toBe(1);
    expect(errorsCaught.length).toBe(1);
    expect(errorsCaught[0].message).toBe('Simulated transient failure');
    // Key must not be wedged / running
    expect(flight.isRunning('service-flaky')).toBe(false);

    // Run 2: schedule again on the same key
    flight.schedule('service-flaky');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Must have executed successfully without getting wedged
    expect(attempts).toBe(2);
    expect(flight.isRunning('service-flaky')).toBe(false);
  });

  test('different keys run independently', async () => {
    const executedKeys = [];

    const flight = createSingleFlightByKey(async (key) => {
      executedKeys.push(key);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    flight.schedule('key-A');
    flight.schedule('key-B');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(executedKeys).toContain('key-A');
    expect(executedKeys).toContain('key-B');
    expect(flight.isRunning('key-A')).toBe(false);
    expect(flight.isRunning('key-B')).toBe(false);
  });
});
