const dotenv = require('dotenv');
const path = require('path');

// Load .env from server/ root (one level up from src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/smartqueue',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  TIMEZONE: process.env.TIMEZONE || 'Asia/Kolkata',
};

module.exports = env;
