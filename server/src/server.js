const http = require('http');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');
const { createRealtime } = require('./realtime');

// Load all models so Mongoose registers their schemas and creates indexes
require('./models');

async function start() {
  try {
    await connectDB();

    const httpServer = http.createServer(app);
    createRealtime(httpServer);

    httpServer.listen(env.PORT, () => {
      console.log(`SmartQueue server listening on port ${env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
