const os = require('os');
const { execSync } = require('child_process');
const path = require('path');

// Ensure server/node_modules is resolvable
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const mongoose = require('mongoose');
const Redis = require('ioredis');

/**
 * Gathers system and environment information for benchmark reporting.
 */
async function getEnvInfo({ apiUrl, mongoUri, redisUrl } = {}) {
  const cpus = os.cpus() || [];
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
  const cpuCores = cpus.length;
  const totalRamGb = Math.round((os.totalmem() / (1024 ** 3)) * 100) / 100;
  const osType = `${os.type()} ${os.release()} (${os.arch()})`;
  const nodeVersion = process.version;

  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    // Git might not be installed or in detached state
  }

  let mongoVersion = 'unknown';
  try {
    const uri = mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017/smartqueue_bench';
    const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 3000 }).asPromise();
    const buildInfo = await conn.db.admin().buildInfo();
    mongoVersion = buildInfo.version || 'unknown';
    await conn.close();
  } catch (err) {
    mongoVersion = `unreachable (${err.message})`;
  }

  let redisVersion = 'unknown';
  try {
    const rUrl = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new Redis(rUrl, {
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null, // Do not reconnect on failure
    });
    redis.on('error', () => {}); // Catch error events to prevent unhandled event crash
    await redis.connect();
    const info = await redis.info('server');
    const match = info.match(/redis_version:([^\r\n]+)/);
    if (match) {
      redisVersion = match[1].trim();
    }
    redis.disconnect();
  } catch (err) {
    redisVersion = `unreachable (${err.message})`;
  }

  return {
    cpuModel,
    cpuCores,
    totalRamGb,
    os: osType,
    nodeVersion,
    gitCommit,
    mongoVersion,
    redisVersion,
    apiUrl: apiUrl || 'http://localhost:10000',
  };
}

module.exports = { getEnvInfo };
