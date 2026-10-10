/**
 * Single-flight coalescing engine keyed by string.
 *
 * Guarantees:
 * 1. Only ONE asynchronous execution runs per key at any given time.
 * 2. Bursts coalesce: any calls arriving while a run is in flight trigger
 *    at most ONE subsequent rerun after the current run completes.
 * 3. Resilience: if a run throws, the key is never wedged; the error is caught
 *    (and passed to onError if provided), and subsequent schedule calls execute normally.
 * 4. Supports optional item accumulation via a Set per key.
 */
function createSingleFlightByKey(workerFn, options = {}) {
  const flightMap = new Map();
  const onError =
    options.onError ||
    ((err, key) => {
      console.error(`Error in singleFlight execution for key "${key}":`, err.message || err);
    });

  function getEntry(key) {
    let entry = flightMap.get(key);
    if (!entry) {
      entry = {
        key,
        isRunning: false,
        rerunScheduled: false,
        items: new Set(),
      };
      flightMap.set(key, entry);
    }
    return entry;
  }

  async function executeRun(entry) {
    try {
      do {
        entry.rerunScheduled = false;
        try {
          await workerFn(entry.key, entry);
        } catch (err) {
          onError(err, entry.key);
        }
      } while (entry.rerunScheduled);
    } finally {
      entry.isRunning = false;
      if (!entry.rerunScheduled && entry.items.size === 0) {
        flightMap.delete(entry.key);
      }
    }
  }

  function schedule(key, item) {
    const entry = getEntry(key);
    if (item !== undefined && item !== null) {
      entry.items.add(item);
    }

    if (entry.isRunning) {
      entry.rerunScheduled = true;
      return;
    }

    entry.isRunning = true;
    executeRun(entry);
  }

  function isRunning(key) {
    const entry = flightMap.get(key);
    return Boolean(entry && entry.isRunning);
  }

  function clear() {
    flightMap.clear();
  }

  return {
    schedule,
    isRunning,
    clear,
    _flightMap: flightMap,
  };
}

module.exports = {
  createSingleFlightByKey,
};
