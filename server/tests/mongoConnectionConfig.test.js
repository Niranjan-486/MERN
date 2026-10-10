const path = require('path');

describe('MongoDB Connection Configuration & URI Resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('prioritizes MONGODB_URI over MONGO_URI when both are present', () => {
    const atlasUri = 'mongodb+srv://atlas-user:testPassword123@cluster0.example.mongodb.net/smartqueue';
    const localhostUri = 'mongodb://localhost:27017/smartqueue';

    process.env.MONGODB_URI = atlasUri;
    process.env.MONGO_URI = localhostUri;
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.OTP_CODE = '123456';
    process.env.STAFF_OTP_CODE = 'staffsecret123';
    process.env.CLIENT_ORIGIN = 'http://localhost:5173';

    const env = require('../src/config/env');
    expect(env.MONGODB_URI).toBe(atlasUri);
    expect(env.MONGO_URI).toBe(atlasUri);
  });

  it('falls back to MONGO_URI when MONGODB_URI is not set', () => {
    const fallbackUri = 'mongodb://custom-host:27017/smartqueue';

    delete process.env.MONGODB_URI;
    process.env.MONGO_URI = fallbackUri;
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.OTP_CODE = '123456';
    process.env.STAFF_OTP_CODE = 'staffsecret123';
    process.env.CLIENT_ORIGIN = 'http://localhost:5173';

    const env = require('../src/config/env');
    expect(env.MONGODB_URI).toBe(fallbackUri);
    expect(env.MONGO_URI).toBe(fallbackUri);
  });

  it('fails fast and does not silently fall back to localhost in production when URI is missing', () => {
    // Mock dotenv.config so .env file doesn't provide MONGO_URI
    const dotenv = require('dotenv');
    const origConfig = dotenv.config;
    dotenv.config = jest.fn();

    try {
      delete process.env.MONGODB_URI;
      delete process.env.MONGO_URI;
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a'.repeat(32);
      process.env.OTP_CODE = '123456';
      process.env.STAFF_OTP_CODE = 'staffsecret123';
      process.env.CLIENT_ORIGIN = 'http://localhost:5173';

      expect(() => {
        require('../src/config/env');
      }).toThrow(/MONGODB_URI is required/);
    } finally {
      dotenv.config = origConfig;
    }
  });

  it('connectDB uses customUri if supplied', async () => {
    const mongoose = require('mongoose');
    const connectSpy = jest.spyOn(mongoose, 'connect').mockImplementation(async () => {
      return mongoose;
    });

    const customUri = 'mongodb+srv://user:pass@cluster0.mongodb.net/testdb';
    const { connectDB } = require('../src/config/db');

    await connectDB(customUri);

    expect(connectSpy).toHaveBeenCalledWith(
      customUri,
      expect.objectContaining({ serverSelectionTimeoutMS: 10000 })
    );

    connectSpy.mockRestore();
  });

  it('sanitizes credentials from error output on connection failure', async () => {
    const mongoose = require('mongoose');
    const sensitiveUri = 'mongodb+srv://admin_user:superSecretPassword99@cluster0.mongodb.net/prod';

    const connectSpy = jest.spyOn(mongoose, 'connect').mockImplementation(async () => {
      throw new Error(`Failed to connect to ${sensitiveUri} server selection timeout`);
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit: ${code}`);
    });

    const { connectDB } = require('../src/config/db');

    await expect(connectDB(sensitiveUri)).rejects.toThrow('process.exit: 1');

    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedError = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');

    // Asserts password is NOT in the logged error output
    expect(loggedError).not.toContain('superSecretPassword99');
    expect(loggedError).toContain('***:***@');

    connectSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
