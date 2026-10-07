/**
 * Creates a single-flight coalescing runner for async operations.
 * - Calling run() any number of times guarantees `fn` never runs concurrently with itself.
 * - If run() is called one or more times while `fn` is already in flight, `fn` will run
 *   exactly ONE more time after the current invocation finishes.
 *
 * @param {Function} fn Async function to coalesce
 * @returns {{ run: Function, isRunning: Function, isRerunScheduled: Function }}
 */
export function createCoalescedRunner(fn) {
  let isRunning = false;
  let rerunScheduled = false;

  async function execute() {
    isRunning = true;
    try {
      await fn();
    } catch (err) {
      // Allow unhandled promise rejections to be caught or logged without breaking the loop
      console.error('Coalesced runner execution error:', err);
    } finally {
      isRunning = false;
      if (rerunScheduled) {
        rerunScheduled = false;
        // Run exactly ONE more time afterwards
        execute();
      }
    }
  }

  function run() {
    if (isRunning) {
      rerunScheduled = true;
      return;
    }
    return execute();
  }

  return {
    run,
    isRunning: () => isRunning,
    isRerunScheduled: () => rerunScheduled,
  };
}
