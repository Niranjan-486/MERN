const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

// Seed script
const { seed } = require('../server/src/scripts/seed.js');

/**
 * Finds an available TCP port.
 */
function findFreePort(startPort = 10001) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

/**
 * Prepares bench database, seeds data, and starts an ephemeral local server.
 */
async function startEphemeralServer({
  mongoUri = 'mongodb://localhost:27017/smartqueue_bench?maxPoolSize=300',
  redisUrl = 'redis://localhost:6379',
  simulatorKey = 'smartqueue-bench-simulator-key-2026-safe',
  onLog,
} = {}) {
  const log = (msg) => {
    if (typeof onLog === 'function') onLog(msg);
  };

  log(`Preparing benchmark database at: ${mongoUri}`);

  // 1. Clean and Seed bench database
  const conn = await mongoose.createConnection(mongoUri).asPromise();
  await conn.dropDatabase();
  await conn.close();

  log('Seeding initial organization, service, counter and staff user...');
  await seed({
    mongoUri,
    argv: ['--yes'],
    exitOnError: false,
    closeConnection: true,
  });

  // 2. Find free port
  const port = await findFreePort(10050);
  const apiUrl = `http://localhost:${port}`;
  log(`Spawning server process on port ${port}...`);

  // 3. Spawn child server process
  const serverPath = path.resolve(__dirname, '../server/src/server.js');
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    MONGODB_URI: mongoUri,
    MONGO_URI: mongoUri,
    REDIS_URL: redisUrl,
    SIMULATOR_KEY: simulatorKey,
    JWT_SECRET: 'bench_jwt_secret_key_at_least_32_characters_long_12345',
    OTP_CODE: '123456',
    STAFF_OTP_CODE: 'staffsecret123',
    CLIENT_ORIGIN: 'http://localhost:5173',
    JOBS_ENABLED: 'true',
    NOTIFY_CHANNELS: 'inapp,log',
  };

  const child = spawn(process.execPath, [serverPath], {
    env,
    cwd: path.resolve(__dirname, '../server'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => {
    // Optional verbose logging
  });

  child.stderr.on('data', (d) => {
    const text = d.toString();
    if (!text.includes('WARNING: SIMULATOR_KEY')) {
      // log(`[server stderr] ${text.trim()}`);
    }
  });

  // 4. Wait for server healthcheck
  log(`Waiting for server to become healthy at ${apiUrl}/health...`);
  const maxAttempts = 30;
  let healthy = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`${apiUrl}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch (_) {}
  }

  if (!healthy) {
    child.kill('SIGKILL');
    throw new Error(`Ephemeral server failed to start on port ${port} within 15s`);
  }

  log(`Ephemeral server ready at ${apiUrl}`);

  const stopServer = async () => {
    log('Stopping ephemeral server process...');
    return new Promise((resolve) => {
      if (child.killed || child.exitCode !== null) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {}
        resolve();
      }, 5000);

      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      child.kill('SIGTERM');
    });
  };

  return {
    apiUrl,
    port,
    mongoUri,
    redisUrl,
    simulatorKey,
    child,
    stopServer,
  };
}

module.exports = {
  findFreePort,
  startEphemeralServer,
};
