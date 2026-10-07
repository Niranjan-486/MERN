const dotenv = require('dotenv');
const path = require('path');

// Load .env from server/ root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isTest = process.env.NODE_ENV === 'test';

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  MONGO_URI:
    process.env.MONGO_URI ||
    (isTest
      ? 'mongodb://localhost:27017/smartqueue_test'
      : 'mongodb://localhost:27017/smartqueue'),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  TIMEZONE: process.env.TIMEZONE || 'Asia/Kolkata',
  JWT_SECRET:
    process.env.JWT_SECRET ||
    (isTest ? 'test_jwt_secret_key_that_is_at_least_32_characters_long!' : ''),
  OTP_CODE: process.env.OTP_CODE || (isTest ? '123456' : ''),
  STAFF_OTP_CODE: process.env.STAFF_OTP_CODE || (isTest ? 'staffsecret123' : ''),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || (isTest ? 'http://localhost:5173' : ''),
};

// Fail-fast startup validation with clear messages
if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
  throw new Error('Config error: JWT_SECRET must be at least 32 characters long');
}
if (!env.OTP_CODE) {
  throw new Error('Config error: OTP_CODE is required');
}
if (!env.STAFF_OTP_CODE || env.STAFF_OTP_CODE.length < 8) {
  throw new Error('Config error: STAFF_OTP_CODE must be at least 8 characters long');
}
if (!env.CLIENT_ORIGIN) {
  throw new Error('Config error: CLIENT_ORIGIN is required');
}

module.exports = env;
