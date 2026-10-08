const mongoose = require('mongoose');
const env = require('./env');

/**
 * Connect to MongoDB. Returns the mongoose connection promise.
 * Mongoose buffers commands until connected, so models work immediately.
 */
async function connectDB() {
  try {
    await mongoose.connect(env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    const host = mongoose.connection.host || 'unknown';
    const dbName = mongoose.connection.name || 'unknown';
    console.log(`MongoDB connected to host: ${host}, database: ${dbName}`);
  } catch (err) {
    console.error(`MongoDB initial connection failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { connectDB };
