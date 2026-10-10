const { Token, Service } = require('../models');
const queueService = require('../services/queueService');
const { getQueueDate } = require('../utils/queueDate');
const { scheduleNearPlanner, runNearPlannerDirect } = require('./planner');
const env = require('../config/env');

let sweeperInterval = null;
let isSweeping = false;
let isJobsRunningCheck = () => false;

/**
 * Configure callback to determine whether jobs system (Redis + workers) is running.
 */
function setJobsRunningCheck(fn) {
  isJobsRunningCheck = fn;
}

/**
 * Single sweep pass:
 * (a) Finds called tokens past their grace period and calls markNoShow directly.
 *     (Heals overdue tokens even when Redis is down or was restarted).
 * (b) Runs the near-planner for every active service for today (skipped while job system is down).
 */
async function runSweeper() {
  if (isSweeping) return;
  isSweeping = true;

  try {
    const now = Date.now();
    const graceMs = (env.NO_SHOW_GRACE_SECONDS || 180) * 1000;
    const cutoff = new Date(now - graceMs + 1000);

    // Part (a): Recover overdue called tokens using the (status, calledAt) index
    const overdue = await Token.find({
      status: 'called',
      calledAt: { $lte: cutoff },
    });

    for (const t of overdue) {
      try {
        await queueService.markNoShow({
          tokenId: t._id,
          graceMs,
          now,
        });
      } catch (err) {
        console.warn(`[SWEEPER] Error marking no-show for token ${t._id}:`, err.message);
      }
    }

    // Part (b): Run near-planner for all active services today if job system is running
    if (isJobsRunningCheck()) {
      const activeServices = await Service.find({ isActive: true }).select('_id');
      const queueDate = getQueueDate();
      for (const s of activeServices) {
        await runNearPlannerDirect(s._id.toString(), queueDate);
      }
    }
  } catch (err) {
    console.error('[SWEEPER] Error during sweeper execution:', err.message);
  } finally {
    isSweeping = false;
  }
}

/**
 * Starts the sweeper background loop. Runs immediately at start and every 30 seconds.
 */
function startSweeper(intervalMs = 30000) {
  if (sweeperInterval) return;

  // Run initial sweep immediately
  runSweeper().catch((err) => {
    console.error('[SWEEPER] Initial sweep error:', err.message);
  });

  sweeperInterval = setInterval(() => {
    runSweeper().catch((err) => {
      console.error('[SWEEPER] Periodic sweep error:', err.message);
    });
  }, intervalMs);

  // Unref interval so it never holds the process open in tests
  if (sweeperInterval.unref) {
    sweeperInterval.unref();
  }
}

/**
 * Stops the sweeper interval.
 */
function stopSweeper() {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
  }
}

module.exports = {
  startSweeper,
  stopSweeper,
  runSweeper,
  setJobsRunningCheck,
};
