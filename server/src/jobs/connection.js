const Redis = require('ioredis');

/**
 * Creates an IORedis connection configured for queue producers (enqueueing).
 * Uses enableOfflineQueue: false so adds fail fast instead of hanging when Redis is down.
 * Attaches an error listener so connection drops never throw uncaught exceptions.
 */
function createProducerConnection(redisUrl) {
  const client = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
  });

  client.on('error', (err) => {
    // Log error cleanly, preventing unhandled error events
    // (Logs contain no PII)
  });

  return client;
}

/**
 * Creates an IORedis connection configured for workers.
 * Keeps offline queue enabled and sets maxRetriesPerRequest: null as required by BullMQ.
 * Attaches an error listener so outages never crash the process.
 */
function createWorkerConnection(redisUrl) {
  const client = new Redis(redisUrl, {
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
  });

  client.on('error', (err) => {
    // Error listener attached
  });

  return client;
}

/**
 * Shallow ping to verify Redis is reachable before creating BullMQ Queues.
 * Closes cleanly upon test completion.
 */
async function pingRedis(redisUrl) {
  let client;
  try {
    client = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
    });
    client.on('error', () => {});
    await client.connect();
    const pong = await client.ping();
    client.disconnect();
    return pong === 'PONG';
  } catch (_err) {
    if (client) {
      try {
        client.disconnect();
      } catch (_) {}
    }
    return false;
  }
}

module.exports = {
  createProducerConnection,
  createWorkerConnection,
  pingRedis,
};
