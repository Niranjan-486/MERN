const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

router.get('/', (_req, res) => {
  const mongoState = mongoose.connection.readyState;
  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const isHealthy = mongoState === 1;

  const payload = {
    status: isHealthy ? 'ok' : 'degraded',
    mongo: isHealthy ? 'connected' : 'not connected',
    uptime: Math.floor(process.uptime()),
  };

  res.status(isHealthy ? 200 : 503).json(payload);
});

module.exports = router;
