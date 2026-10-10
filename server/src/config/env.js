const dotenv = require('dotenv');
const path = require('path');

// Load .env from server/ root or current working directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const isTest = process.env.NODE_ENV === 'test';

const rawOrigins = process.env.CLIENT_ORIGIN || (isTest ? 'http://localhost:5173' : '');
const clientOrigins = rawOrigins
  ? rawOrigins
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  : [];

// MONGODB_URI takes precedence over MONGO_URI.
// Never silently fall back to localhost in non-test environments.
const rawMongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 10000,
  MONGODB_URI: rawMongoUri || (isTest ? 'mongodb://localhost:27017/smartqueue_test' : ''),
  MONGO_URI: rawMongoUri || (isTest ? 'mongodb://localhost:27017/smartqueue_test' : ''),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  TIMEZONE: process.env.TIMEZONE || 'Asia/Kolkata',
  JWT_SECRET:
    process.env.JWT_SECRET ||
    (isTest ? 'test_jwt_secret_key_that_is_at_least_32_characters_long!' : ''),
  OTP_CODE: process.env.OTP_CODE || (isTest ? '123456' : ''),
  STAFF_OTP_CODE: process.env.STAFF_OTP_CODE || (isTest ? 'staffsecret123' : ''),
  CLIENT_ORIGIN: rawOrigins,
  CLIENT_ORIGINS: clientOrigins,
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
if (clientOrigins.length === 0) {
  throw new Error('Config error: CLIENT_ORIGIN is required');
}
if (!isTest && !env.MONGODB_URI) {
  throw new Error('Config error: MONGODB_URI is required. Please set MONGODB_URI (or MONGO_URI).');
}

module.exports = env;
