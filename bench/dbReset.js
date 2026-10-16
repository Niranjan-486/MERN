const path = require('path');
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const mongoose = require('mongoose');

/**
 * Resets queue data between benchmark scenarios to guarantee clean,
 * deterministic baseline state for each scenario.
 */
async function resetScenarioDb(mongoUri = 'mongodb://localhost:27017/smartqueue_bench') {
  const conn = await mongoose.createConnection(mongoUri, { serverSelectionTimeoutMS: 5000 }).asPromise();

  try {
    await Promise.all([
      conn.collection('tokens').deleteMany({}),
      conn.collection('tokensequences').deleteMany({}),
      conn.collection('notifications').deleteMany({}),
      conn.collection('pushsubscriptions').deleteMany({}),
      conn.collection('users').deleteMany({ role: 'patient' }),
      conn.collection('counters').updateMany({}, { $set: { currentTokenId: null } }),
      conn.collection('services').updateMany({}, { $set: { avgServiceTimeSec: 180, serviceSamples: 5 } }),
    ]);
  } catch (err) {
    // If collections don't exist yet, ignore
  } finally {
    await conn.close();
  }
}

module.exports = { resetScenarioDb };
