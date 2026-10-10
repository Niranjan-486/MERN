const { createSingleFlightByKey } = require('../utils/singleFlightByKey');
const queueService = require('../services/queueService');
const { Notification } = require('../models');
const { addNotifyJob } = require('./queues');
const env = require('../config/env');

/**
 * Plans and dispatches "near" notifications for waiting tokens close to the counter.
 * Queries MongoDB first to avoid churning Redis with duplicate jobs.
 */
async function planNearInternal(serviceId, queueDate) {
  const snapshot = await queueService.getQueueSnapshot(serviceId, queueDate);
  const threshold = env.NEAR_THRESHOLD !== undefined ? env.NEAR_THRESHOLD : 3;

  // Find waiting tokens where index (peopleAhead) <= threshold
  const candidates = snapshot.waitingTokens.filter((_t, idx) => idx <= threshold);
  if (candidates.length === 0) {
    return;
  }

  // Look up existing "near" notifications in MongoDB first
  const candidateIds = candidates.map((t) => (t._id || t.id).toString());
  const existing = await Notification.find({
    tokenId: { $in: candidateIds },
    kind: 'near',
  }).select('tokenId');

  const existingSet = new Set(existing.map((n) => n.tokenId.toString()));

  // Enqueue notification job only for tokens without an existing "near" notification
  for (const t of candidates) {
    const tid = (t._id || t.id).toString();
    if (!existingSet.has(tid)) {
      await addNotifyJob(`notify-${tid}-near`, {
        tokenId: tid,
        kind: 'near',
      });
    }
  }
}

// Single-flight coalescing per (serviceId, queueDate)
const plannerFlight = createSingleFlightByKey(
  async (key) => {
    const [serviceId, queueDate] = key.split(':');
    await planNearInternal(serviceId, queueDate);
  },
  {
    onError: (err, key) => {
      console.error(`[PLANNER] Error running near-planner for ${key}:`, err.message || err);
    },
  }
);

/**
 * Schedules near-planner execution for a given service and queueDate.
 * Bursts coalesce into at most one subsequent rerun.
 */
function scheduleNearPlanner(serviceId, queueDate) {
  if (!serviceId || !queueDate) return;
  const key = `${serviceId}:${queueDate}`;
  plannerFlight.schedule(key);
}

/**
 * Direct execution helper (useful for sweeper and tests).
 */
async function runNearPlannerDirect(serviceId, queueDate) {
  await planNearInternal(serviceId, queueDate);
}

module.exports = {
  scheduleNearPlanner,
  runNearPlannerDirect,
  _plannerFlight: plannerFlight,
};
