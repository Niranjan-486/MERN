const http = require('http');
const mongoose = require('mongoose');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');
const { createRealtime } = require('./realtime');
const {
  Organization,
  Service,
  Counter,
  User,
  Token,
  TokenSequence,
} = require('./models');

async function buildAllIndexes() {
  const models = [Organization, Service, Counter, User, Token, TokenSequence];
  for (const model of models) {
    try {
      await model.init();
    } catch (err) {
      console.error(`Failed to build database indexes for model "${model.modelName}": ${err.message}`);
      throw new Error(`Failed to build database indexes for model "${model.modelName}": ${err.message}`);
    }
  }
  console.log('All model indexes verified and built successfully.');
}

async function start() {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Build and verify all model indexes before accepting traffic
    await buildAllIndexes();

    // 3. Create HTTP server and attach Socket.io
    const httpServer = http.createServer(app);
    const io = createRealtime(httpServer);

    // 4. Start listening on PORT, bound to 0.0.0.0
    httpServer.listen(env.PORT, '0.0.0.0', () => {
      console.log(`SmartQueue server listening on 0.0.0.0:${env.PORT}`);
    });

    // Graceful shutdown on SIGTERM (sent by Render during deploys) and SIGINT
    let isShuttingDown = false;
    const shutdown = (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, initiating graceful shutdown...`);

      const forceTimeout = setTimeout(() => {
        console.error('Graceful shutdown timed out after 10s, forcing exit');
        process.exit(1);
      }, 10000);
      forceTimeout.unref();

      httpServer.close(async () => {
        console.log('HTTP server closed, stopped accepting new connections');
        try {
          if (io) {
            if (typeof io.cleanup === 'function') {
              io.cleanup();
            }
            await new Promise((resolve) => io.close(resolve));
            console.log('Socket.io server closed');
          }
          await mongoose.connection.close(false);
          console.log('MongoDB connection closed');
          process.exit(0);
        } catch (closeErr) {
          console.error('Error during graceful shutdown:', closeErr);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('Failed to start server:', err.message || err);
    process.exit(1);
  }
}

start();
