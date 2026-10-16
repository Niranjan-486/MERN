/**
 * Tracks socket convergence: monitors `token:updated` events across connected
 * patient sockets until every socket has received an event reflecting its true `peopleAhead`.
 */
class ConvergenceTracker {
  constructor(targets, startTime = Date.now()) {
    // targets: Array of { userId, tokenId, expectedPeopleAhead }
    this.startTime = startTime;
    this.targets = new Map();
    for (const t of targets) {
      this.targets.set(String(t.userId), {
        userId: String(t.userId),
        tokenId: t.tokenId ? String(t.tokenId) : null,
        expectedPeopleAhead: t.expectedPeopleAhead,
        converged: false,
        convergedAt: null,
        lastPeopleAhead: null,
      });
    }
  }

  setTokenId(userId, tokenId) {
    const target = this.targets.get(String(userId));
    if (target) {
      target.tokenId = String(tokenId);
    }
  }

  setExpectedPeopleAhead(userId, expectedPeopleAhead) {
    const target = this.targets.get(String(userId));
    if (target) {
      target.expectedPeopleAhead = expectedPeopleAhead;
      if (target.lastPeopleAhead === expectedPeopleAhead) {
        target.converged = true;
        if (!target.convergedAt) {
          target.convergedAt = Date.now();
        }
      }
    }
  }

  recordEvent(userId, evt, timestamp = Date.now()) {
    const target = this.targets.get(String(userId));
    if (!target) return;

    if (evt && typeof evt.peopleAhead === 'number') {
      target.lastPeopleAhead = evt.peopleAhead;
      if (
        (!target.tokenId || evt.tokenId === target.tokenId) &&
        target.expectedPeopleAhead !== undefined &&
        evt.peopleAhead === target.expectedPeopleAhead
      ) {
        target.converged = true;
        target.convergedAt = timestamp;
      }
    }
  }

  isConverged() {
    if (this.targets.size === 0) return true;
    for (const target of this.targets.values()) {
      if (!target.converged) return false;
    }
    return true;
  }

  getConvergenceTime() {
    if (!this.isConverged()) return null;
    let maxTime = this.startTime;
    for (const target of this.targets.values()) {
      if (target.convergedAt && target.convergedAt > maxTime) {
        maxTime = target.convergedAt;
      }
    }
    return Math.max(0, maxTime - this.startTime);
  }

  getStatus() {
    let convergedCount = 0;
    for (const target of this.targets.values()) {
      if (target.converged) convergedCount++;
    }
    return {
      total: this.targets.size,
      convergedCount,
      isConverged: convergedCount === this.targets.size,
      convergenceTimeMs: this.getConvergenceTime(),
    };
  }
}

/**
 * Calculates convergence time from an array of arrival timestamps relative to burst start.
 */
function calculateConvergenceTime(clientTimestamps, startTime) {
  if (!clientTimestamps || !Array.isArray(clientTimestamps) || clientTimestamps.length === 0) {
    return 0;
  }
  const maxTimestamp = Math.max(...clientTimestamps);
  return Math.max(0, maxTimestamp - startTime);
}

module.exports = {
  ConvergenceTracker,
  calculateConvergenceTime,
};
