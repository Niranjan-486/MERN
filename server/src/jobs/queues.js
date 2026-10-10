const { Queue } = require('bullmq');

let timersQueue = null;
let notifyQueue = null;
let producerConnection = null;

/**
 * Initializes BullMQ Queues with producer connection.
 * Attach error listeners to each queue to ensure outages never crash the process.
 */
function initQueues(connection, options = {}) {
  producerConnection = connection;
  const prefix = options.prefix || 'bull';

  timersQueue = new Queue('timers', {
    connection,
    prefix,
    defaultJobOptions: {
      removeOnComplete: { age: 600, count: 200 },
      removeOnFail: { age: 86400, count: 500 },
    },
  });

  notifyQueue = new Queue('notify', {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 600, count: 200 },
      removeOnFail: { age: 86400, count: 500 },
    },
  });

  timersQueue.on('error', (_err) => {
    // Error listener attached
  });

  notifyQueue.on('error', (_err) => {
    // Error listener attached
  });

  return { timersQueue, notifyQueue };
}

/**
 * Closes queues and producer connection cleanly.
 */
async function closeQueues() {
  const promises = [];
  if (timersQueue) promises.push(timersQueue.close().catch(() => {}));
  if (notifyQueue) promises.push(notifyQueue.close().catch(() => {}));
  await Promise.all(promises);
  timersQueue = null;
  notifyQueue = null;

  if (producerConnection) {
    try {
      producerConnection.disconnect();
    } catch (_) {}
    producerConnection = null;
  }
}

/**
 * Enqueues a timer job with deterministic jobId and delay.
 * Fire-and-forget; never fails or slows down a request.
 */
async function addTimerJob(jobId, data, opts = {}) {
  if (!timersQueue) {
    return;
  }
  try {
    await timersQueue.add('noshow', data, {
      jobId,
      delay: opts.delay || 0,
      ...opts,
    });
  } catch (err) {
    console.warn(`[JOBS] Failed to enqueue timer job ${jobId}:`, err.message);
  }
}

/**
 * Best-effort removal of a scheduled timer job.
 * Correctness never depends on the removal.
 */
async function removeTimerJob(jobId) {
  if (!timersQueue) return;
  try {
    const job = await timersQueue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  } catch (_err) {
    // Best-effort
  }
}

/**
 * Enqueues a notification job with deterministic jobId.
 * Fire-and-forget; never fails or slows down a request.
 */
async function addNotifyJob(jobId, data, opts = {}) {
  if (!notifyQueue) {
    return;
  }
  try {
    await notifyQueue.add('notify', data, {
      jobId,
      ...opts,
    });
  } catch (err) {
    console.warn(`[JOBS] Failed to enqueue notify job ${jobId}:`, err.message);
  }
}

function getQueues() {
  return { timersQueue, notifyQueue };
}

module.exports = {
  initQueues,
  closeQueues,
  addTimerJob,
  removeTimerJob,
  addNotifyJob,
  getQueues,
};
