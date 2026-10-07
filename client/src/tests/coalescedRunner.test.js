import { describe, test, expect } from 'vitest';
import { createCoalescedRunner } from '../lib/coalescedRunner';

describe('createCoalescedRunner', () => {
  test('10 rapid run() calls while fn is slow make fn run exactly twice, never concurrently', async () => {
    let callCount = 0;
    let concurrencyCount = 0;
    let maxConcurrency = 0;

    // Slow async function
    const slowFn = async () => {
      concurrencyCount++;
      maxConcurrency = Math.max(maxConcurrency, concurrencyCount);
      await new Promise((resolve) => setTimeout(resolve, 50));
      concurrencyCount--;
      callCount++;
    };

    const runner = createCoalescedRunner(slowFn);

    // Call run() 10 times in rapid succession
    runner.run();
    for (let i = 0; i < 9; i++) {
      runner.run();
    }

    // Wait enough time for the first and the single coalesced second run to finish
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(callCount).toBe(2);
    expect(maxConcurrency).toBe(1);
    expect(runner.isRunning()).toBe(false);
    expect(runner.isRerunScheduled()).toBe(false);
  });
});
