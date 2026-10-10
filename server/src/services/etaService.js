/**
 * ETA Estimation Service
 *
 * Implements a pure deterministic simulation of counter availability
 * to calculate estimated wait times (in seconds) for all tokens currently waiting in queue.
 *
 * Key simulation rules:
 * 1. Only ACTIVE counters participate; paused and offline counters are completely ignored.
 *    If no active counters exist, all waiting tokens receive null.
 * 2. Initial counter availability (busyUntil):
 *    - Idle counter: busyUntil = now
 *    - Counter holding a CALLED token: busyUntil = now + avgServiceSec
 *    - Counter holding a SERVING token: busyUntil = now + max(30, avgServiceSec - secondsAlreadyServing)
 *      (Ensures an overdue consultation still allows at least 30 seconds buffer for handoff).
 * 3. Discrete-event simulation per waiting token:
 *    - For each waiting token in arrival/priority order, assign the counter that frees up earliest.
 *    - etaSeconds = max(0, earliestCounterFreeTime - now).
 *    - That counter's busyUntil advances by avgServiceSec (thatTime + avgServiceSec).
 * 4. Mathematical invariant: ETAs never decrease along the waiting list.
 */

/**
 * Normalizes input timestamp or Date object into whole seconds since epoch.
 * Supports Date objects, second timestamps, and millisecond timestamps.
 */
function normalizeToSeconds(val) {
  if (val instanceof Date) {
    return Math.floor(val.getTime() / 1000);
  }
  if (typeof val === 'number') {
    // If millisecond epoch (greater than ~1973 in ms: 1e11), convert to seconds
    return val > 1e11 ? Math.floor(val / 1000) : Math.floor(val);
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * Computes estimated wait times for a list of waiting tokens.
 *
 * @param {Object} params
 * @param {Date|number} [params.now] - Current reference time (Date, ms, or seconds).
 * @param {Array} params.waiting - Array of waiting token objects (in call order).
 * @param {Array} params.counters - Array of counter objects with status and current token info.
 * @param {number} [params.avgServiceSec=300] - Service average consultation duration in seconds.
 * @returns {Array<number|null>} Array of etaSeconds aligned with the `waiting` array.
 */
function computeEtas({ now, waiting = [], counters = [], avgServiceSec = 300 }) {
  if (!Array.isArray(waiting) || waiting.length === 0) {
    return [];
  }

  // 1. Filter strictly for active counters. Paused/offline counters are excluded.
  const activeCounters = (counters || []).filter((c) => c && c.status === 'active');

  // If no active counters are available to serve patients, wait time cannot be estimated.
  if (activeCounters.length === 0) {
    return waiting.map(() => null);
  }

  const nowSec = normalizeToSeconds(now);
  const avg = typeof avgServiceSec === 'number' && avgServiceSec > 0 ? avgServiceSec : 300;

  // 2. Initialize simulated counter availability (busyUntil timestamp in seconds)
  const simulatedCounters = activeCounters.map((c) => {
    const token = c.currentToken || c.token;
    const tokenStatus = token ? token.status : (c.tokenStatus || c.currentTokenStatus || null);

    if (tokenStatus === 'called') {
      // Counter has called a patient; patient needs to arrive + full consultation
      return { busyUntil: nowSec + avg };
    }

    if (tokenStatus === 'serving') {
      // Counter is in consultation; calculate elapsed time in serving
      let secondsAlreadyServing = 0;
      if (typeof c.secondsAlreadyServing === 'number') {
        secondsAlreadyServing = c.secondsAlreadyServing;
      } else if (token && typeof token.secondsAlreadyServing === 'number') {
        secondsAlreadyServing = token.secondsAlreadyServing;
      } else {
        const servingTime = (token && token.servingAt) || c.servingAt;
        if (servingTime) {
          const servingSec = normalizeToSeconds(servingTime);
          secondsAlreadyServing = Math.max(0, nowSec - servingSec);
        }
      }

      // Remaining service time capped from below at 30 seconds for wrap-up/handoff
      const remainingServiceTime = Math.max(30, avg - secondsAlreadyServing);
      return { busyUntil: nowSec + remainingServiceTime };
    }

    // Counter is currently idle and ready to take a patient immediately
    return { busyUntil: nowSec };
  });

  // 3. Simulate queue dispatch in order of waiting tokens
  const etas = [];

  for (let i = 0; i < waiting.length; i++) {
    // Pick the counter that becomes free earliest
    let earliestIdx = 0;
    for (let j = 1; j < simulatedCounters.length; j++) {
      if (simulatedCounters[j].busyUntil < simulatedCounters[earliestIdx].busyUntil) {
        earliestIdx = j;
      }
    }

    const freeTime = simulatedCounters[earliestIdx].busyUntil;
    const eta = Math.max(0, Math.round(freeTime - nowSec));
    etas.push(eta);

    // That counter is now busy serving this patient until freeTime + avg
    simulatedCounters[earliestIdx].busyUntil = freeTime + avg;
  }

  return etas;
}

module.exports = {
  computeEtas,
  normalizeToSeconds,
};
