const express = require('express');
const crypto = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');
const env = require('../config/env');
const { getIo } = require('../realtime');
const { isJobsRunning } = require('../jobs');
const { getQueues } = require('../jobs/queues');

const router = express.Router();

let eldHistogram = null;
function getHistogram() {
  if (!eldHistogram) {
    eldHistogram = monitorEventLoopDelay({ resolution: 20 });
    eldHistogram.enable();
  }
  return eldHistogram;
}

// Start monitoring event loop delay
getHistogram();

let lastCpuUsage = process.cpuUsage();

function checkMetricsKey(headerKey) {
  const configuredKey = process.env.SIMULATOR_KEY || env.SIMULATOR_KEY;
  if (!configuredKey || !headerKey || typeof headerKey !== 'string') {
    return false;
  }
  const keyBuf = Buffer.from(configuredKey);
  const headerBuf = Buffer.from(headerKey);
  if (keyBuf.length !== headerBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(keyBuf, headerBuf);
}

/**
 * GET /internal/metrics
 * 404 unless SIMULATOR_KEY is set AND x-simulator-key header matches.
 */
router.get('/metrics', async (req, res) => {
  if (!checkMetricsKey(req.headers['x-simulator-key'])) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
      },
    });
  }

  const mem = process.memoryUsage();
  const rssMB = Math.round((mem.rss / (1024 * 1024)) * 100) / 100;
  const heapUsedMB = Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100;

  const cpuDiff = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  const cpu = {
    userMs: Math.round((cpuDiff.user / 1000) * 100) / 100,
    systemMs: Math.round((cpuDiff.system / 1000) * 100) / 100,
  };

  const h = getHistogram();
  const toMs = (ns) =>
    typeof ns === 'number' && !isNaN(ns) ? Math.round((ns / 1e6) * 100) / 100 : 0;
  const eventLoopDelay = {
    p50: toMs(h.percentile(50)),
    p95: toMs(h.percentile(95)),
    p99: toMs(h.percentile(99)),
    max: toMs(h.max),
  };
  h.reset();

  const io = getIo();
  const connectedSockets = io?.engine?.clientsCount || 0;

  const jobsRunning = typeof isJobsRunning === 'function' ? isJobsRunning() : false;
  const jobQueue = { timers: {}, notify: {} };
  try {
    const { timersQueue, notifyQueue } = getQueues();
    if (timersQueue) {
      jobQueue.timers = await timersQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed'
      );
    }
    if (notifyQueue) {
      jobQueue.notify = await notifyQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed'
      );
    }
  } catch (_) {}

  res.status(200).json({
    uptime: Math.round(process.uptime() * 100) / 100,
    rssMB,
    heapUsedMB,
    cpu,
    eventLoopDelay,
    connectedSockets,
    jobQueue,
    jobsRunning,
  });
});

module.exports = router;
