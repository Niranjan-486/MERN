const { pingRedis, createProducerConnection, createWorkerConnection } = require('./connection');
const { initQueues, closeQueues, addTimerJob, removeTimerJob, addNotifyJob } = require('./queues');
const { initWorkers, closeWorkers } = require('./workers');
const { startListener, stopListener } = require('./listener');
const { scheduleNearPlanner, runNearPlannerDirect } = require('./planner');
const { startSweeper, stopSweeper, runSweeper, setJobsRunningCheck } = require('./sweeper');
const env = require('../config/env');

let isRunning = false;
let isRedisUp = false;
let retryTimer = null;
let currentBackoff = 15000;
const MAX_BACKOFF = 60000;

function _initSystem(redisUrl, prefix) {
  try {
    const prodConn = createProducerConnection(redisUrl);
    const workConn = createWorkerConnection(redisUrl);
    initQueues(prodConn, { prefix });
    initWorkers(workConn, { prefix });
    isRunning = true;
    isRedisUp = true;
  } catch (err) {
    console.error('[JOBS] Unexpected error initializing queues/workers:', err.message);
    isRunning = false;
  }
}

function _scheduleRetry(redisUrl, connectFn, prefix, retrySchedule) {
  if (isRunning) return;

  let delay;
  if (Array.isArray(retrySchedule) && retrySchedule.length > 0) {
    delay = retrySchedule.shift();
  } else {
    delay = currentBackoff;
    currentBackoff = Math.min(currentBackoff + 15000, MAX_BACKOFF);
  }

  retryTimer = setTimeout(async () => {
    try {
      const ok = await connectFn(redisUrl);
      if (ok) {
        _initSystem(redisUrl, prefix);
      } else {
        _scheduleRetry(redisUrl, connectFn, prefix, retrySchedule);
      }
    } catch (_err) {
      _scheduleRetry(redisUrl, connectFn, prefix, retrySchedule);
    }
  }, delay);

  if (retryTimer.unref) {
    retryTimer.unref();
  }
}

/**
 * Starts the jobs subsystem.
 * 1. Starts domain event listener and sweeper.
 * 2. Pings Redis first. If reachable, creates queues and workers.
 *    If unreachable, logs ONE warning, keeps the API running, and retries in background.
 */
async function startJobs(options = {}) {
  const redisUrl = options.redisUrl || env.REDIS_URL;
  const connectFn = options.connectFn || pingRedis;
  const prefix = options.prefix || 'bull';
  const retrySchedule = options.retrySchedule ? [...options.retrySchedule] : null;

  // Domain listener starts immediately (handles domain events cleanly)
  startListener();

  // Sweeper starts immediately (part a recovers overdue tokens without Redis)
  setJobsRunningCheck(() => isRunning);
  startSweeper(options.sweeperInterval || 30000);

  // Ping Redis before creating Queues
  const reachable = await connectFn(redisUrl);
  if (reachable) {
    isRedisUp = true;
    _initSystem(redisUrl, prefix);
    return true;
  }

  // Not reachable: keep API running and retry in background
  isRedisUp = false;
  console.warn(
    '[JOBS] Redis is unreachable at startup. Job system is paused; retrying in background...'
  );
  _scheduleRetry(redisUrl, connectFn, prefix, retrySchedule);
  return false;
}

/**
 * Cleanly shuts down workers, queues, Redis connections, listeners and timers.
 */
async function stopJobs() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  currentBackoff = 15000;

  stopListener();
  stopSweeper();
  await closeWorkers();
  await closeQueues();

  isRunning = false;
  isRedisUp = false;
}

function isJobsRunning() {
  return isRunning;
}

function isRedisHealthy() {
  return isRedisUp;
}

module.exports = {
  startJobs,
  stopJobs,
  isJobsRunning,
  isRedisHealthy,
  addTimerJob,
  removeTimerJob,
  addNotifyJob,
  scheduleNearPlanner,
  runNearPlannerDirect,
  runSweeper,
};
