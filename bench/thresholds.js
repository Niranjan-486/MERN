/**
 * Formal benchmark pass/fail thresholds.
 * Correctness is strictly enforced (zero duplicates, zero stuck tokens, contiguity).
 * Latency thresholds are realistic and generous for varied host environments.
 */
const THRESHOLDS = {
  // Correctness invariant thresholds (violations always fail the benchmark)
  correctness: {
    maxDuplicates: 0,
    maxStuckTokens: 0,
    requireContiguous: true,
    maxFailedRequests: 0,
  },

  // Performance thresholds
  burst: {
    getMaxJoinLatencyP95Ms: (n = 100) => {
      if (n <= 100) return 4500;
      if (n <= 250) return 12000;
      return 35000;
    },
    maxConvergenceTimeMs: 35000, // All sockets receive final peopleAhead within 35s
    maxQueueUpdateEventsRatio: 0.35, // queue:updated count should be << N (coalescing proof)
  },

  flow: {
    maxCallNextToCalledP95Ms: 1500, // Time from call-next to patient socket update < 1.5s
    maxNotificationLatencyP95Ms: 1500,
    minCompletionRate: 1.0, // 100% of tokens must reach terminal state
  },

  reconnect: {
    maxReconnectStormDurationMs: 15000, // Reconnect 200 sockets + REST refetch within 15s
    minReconnectRate: 1.0, // 100% of sockets successfully reconnect
  },
};

/**
 * Evaluates scenario results against thresholds.
 * Returns { passed: boolean, failures: string[] }
 */
function evaluateThresholds(scenarioType, result) {
  const failures = [];

  if (scenarioType === 'burst') {
    if (result.hasDuplicates || (result.duplicateCount && result.duplicateCount > 0)) {
      failures.push(`Duplicate token numbers detected (found ${result.duplicateCount || 1} duplicates)`);
    }
    if (result.isContiguous === false) {
      failures.push('Token numbers are not strictly contiguous');
    }
    if (result.errors > THRESHOLDS.correctness.maxFailedRequests) {
      failures.push(`Errors encountered during burst joins: ${result.errors}`);
    }
    const p95 = result.percentiles?.p95 ?? result.p95;
    const maxP95 = typeof THRESHOLDS.burst.getMaxJoinLatencyP95Ms === 'function'
      ? THRESHOLDS.burst.getMaxJoinLatencyP95Ms(result.patientCount || result.totalCount || 100)
      : (THRESHOLDS.burst.maxJoinLatencyP95Ms || 4500);
    if (p95 !== undefined && p95 > maxP95) {
      failures.push(`Join latency p95 (${p95}ms) exceeded threshold (${maxP95}ms)`);
    }
    const convTime = result.convergenceTimeMs ?? result.convergence?.convergenceTimeMs;
    if (convTime !== undefined && convTime > THRESHOLDS.burst.maxConvergenceTimeMs) {
      failures.push(`Convergence time (${convTime}ms) exceeded threshold (${THRESHOLDS.burst.maxConvergenceTimeMs}ms)`);
    }
    const queueRatio = result.queueUpdateRatio ?? (result.avgQueueUpdates && result.totalCount ? result.avgQueueUpdates / result.totalCount : null);
    if (queueRatio !== null && queueRatio > THRESHOLDS.burst.maxQueueUpdateEventsRatio) {
      failures.push(`Queue update ratio (${Math.round(queueRatio * 100)}%) exceeded threshold (${Math.round(THRESHOLDS.burst.maxQueueUpdateEventsRatio * 100)}%)`);
    }
  } else if (scenarioType === 'flow') {
    const stuck = result.stuckCount ?? 0;
    if (stuck > THRESHOLDS.correctness.maxStuckTokens) {
      failures.push(`Stuck tokens detected: ${stuck} tokens remained incomplete`);
    }
    if (result.errors > THRESHOLDS.correctness.maxFailedRequests) {
      failures.push(`Errors encountered during flow: ${result.errors}`);
    }
    const callP95 = result.callNextToCalledPercentiles?.p95 ?? result.callP95;
    if (callP95 !== undefined && callP95 > THRESHOLDS.flow.maxCallNextToCalledP95Ms) {
      failures.push(`Call-next to called latency p95 (${callP95}ms) exceeded threshold (${THRESHOLDS.flow.maxCallNextToCalledP95Ms}ms)`);
    }
    const completionRate = result.completionRate ?? (result.totalCount && result.completedCount ? result.completedCount / result.totalCount : 1.0);
    if (completionRate < THRESHOLDS.flow.minCompletionRate) {
      failures.push(`Completion rate (${Math.round(completionRate * 100)}%) below required (${Math.round(THRESHOLDS.flow.minCompletionRate * 100)}%)`);
    }
  } else if (scenarioType === 'reconnect') {
    if (result.errors > THRESHOLDS.correctness.maxFailedRequests) {
      failures.push(`Errors encountered during reconnect: ${result.errors}`);
    }
    const reconnected = result.reconnectedCount ?? 0;
    const total = result.totalCount ?? 0;
    if (total > 0 && reconnected < total * THRESHOLDS.reconnect.minReconnectRate) {
      failures.push(`Only ${reconnected}/${total} sockets reconnected`);
    }
    const dur = result.durationMs ?? 0;
    if (dur > THRESHOLDS.reconnect.maxReconnectStormDurationMs) {
      failures.push(`Reconnect storm duration (${dur}ms) exceeded threshold (${THRESHOLDS.reconnect.maxReconnectStormDurationMs}ms)`);
    }
    if (result.strandedCount && result.strandedCount > 0) {
      failures.push(`${result.strandedCount} sockets remained stranded`);
    }
    if (result.peopleAheadMismatches && result.peopleAheadMismatches > 0) {
      failures.push(`${result.peopleAheadMismatches} sockets recovered incorrect peopleAhead`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

module.exports = {
  THRESHOLDS,
  evaluateThresholds,
};
