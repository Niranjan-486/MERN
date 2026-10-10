const mongoose = require('mongoose');
const env = require('./env');

/**
 * Connect to MongoDB. Returns the mongoose connection promise.
 * Mongoose buffers commands until connected, so models work immediately.
 */
async function connectDB(customUri) {
  const uri = customUri || env.MONGODB_URI || env.MONGO_URI;
  if (!uri) {
    console.error('MongoDB initial connection failed: MONGODB_URI is required but was not provided.');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    const host = mongoose.connection.host || 'unknown';
    const dbName = mongoose.connection.name || 'unknown';
    console.log(`MongoDB connected to host: ${host}, database: ${dbName}`);
  } catch (err) {
    const safeMsg = (err.message || '').replace(
      /(mongodb(?:\+srv)?:\/\/)([^:@\s]+):([^@\s]+)@/g,
      '$1***:***@'
    );
    console.error(`MongoDB initial connection failed: ${safeMsg}`);
    process.exit(1);
  }
}

module.exports = { connectDB };
