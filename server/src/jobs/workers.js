const { Worker } = require('bullmq');
const queueService = require('../services/queueService');
const { processNotificationJob } = require('../notifications');

let timersWorker = null;
let notifyWorker = null;
let workerConnection = null;

/**
 * Initializes BullMQ Workers.
 * Attaches error listeners to every worker so outages never crash the server.
 */
function initWorkers(connection, options = {}) {
  workerConnection = connection;
  const prefix = options.prefix || 'bull';

  // 1. Timers worker: processes automatic no-show timeouts
  timersWorker = new Worker(
    'timers',
    async (job) => {
      const { tokenId, graceMs } = job.data;
      if (!tokenId) return;
      await queueService.markNoShow({
        tokenId,
        graceMs,
        now: Date.now(),
      });
    },
    {
      connection,
      prefix,
      concurrency: options.timersConcurrency || 5,
    }
  );

  timersWorker.on('error', (_err) => {
    // Error listener attached
  });

  timersWorker.on('failed', (job, err) => {
    console.warn(`[WORKER] Timer job ${job ? job.id : 'unknown'} failed:`, err.message);
  });

  // 2. Notify worker: processes notification delivery jobs
  notifyWorker = new Worker(
    'notify',
    async (job) => {
      const { tokenId, kind } = job.data;
      if (!tokenId || !kind) return;
      await processNotificationJob({ tokenId, kind });
    },
    {
      connection,
      prefix,
      concurrency: options.notifyConcurrency || 5,
    }
  );

  notifyWorker.on('error', (_err) => {
    // Error listener attached
  });

  notifyWorker.on('failed', (job, err) => {
    console.warn(`[WORKER] Notify job ${job ? job.id : 'unknown'} failed:`, err.message);
  });

  return { timersWorker, notifyWorker };
}

/**
 * Closes workers and worker connection cleanly.
 */
async function closeWorkers() {
  const promises = [];
  if (timersWorker) promises.push(timersWorker.close().catch(() => {}));
  if (notifyWorker) promises.push(notifyWorker.close().catch(() => {}));
  await Promise.all(promises);
  timersWorker = null;
  notifyWorker = null;

  if (workerConnection) {
    try {
      workerConnection.disconnect();
    } catch (_) {}
    workerConnection = null;
  }
}

function getWorkers() {
  return { timersWorker, notifyWorker };
}

module.exports = {
  initWorkers,
  closeWorkers,
  getWorkers,
};
