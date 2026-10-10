const express = require('express');
const mongoose = require('mongoose');
const { isRedisHealthy, isJobsRunning } = require('../jobs');

const router = express.Router();

router.get('/', (_req, res) => {
  const mongoHealthy = mongoose.connection.readyState === 1;
  const redisUp = isRedisHealthy();
  const jobsRunning = isJobsRunning();

  const isHealthy = mongoHealthy;

  const payload = {
    status: isHealthy ? 'ok' : 'degraded',
    mongo: mongoHealthy ? 'connected' : 'not connected',
    redis: redisUp ? 'up' : 'down',
    jobs: jobsRunning ? 'running' : 'stopped',
    uptime: Math.floor(process.uptime()),
  };

  res.status(isHealthy ? 200 : 503).json(payload);
});

module.exports = router;
