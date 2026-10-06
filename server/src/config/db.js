const mongoose = require('mongoose');
const env = require('./env');

/**
 * Connect to MongoDB. Returns the mongoose connection promise.
 * Mongoose buffers commands until connected, so models work immediately.
 */
async function connectDB() {
  await mongoose.connect(env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);
}

module.exports = { connectDB };
