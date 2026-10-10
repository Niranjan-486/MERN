const express = require('express');
const { authenticate } = require('../middleware/auth');
const { PushSubscription } = require('../models');
const pushChannel = require('../notifications/channels/push');
const env = require('../config/env');

const router = express.Router();

// In-memory rate limiting map for POST /api/push/test (userId -> timestamp)
const testCallTimestamps = new Map();

/**
 * Base64url regex test
 */
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Validates push subscription payload.
 */
function validateSubscriptionPayload(endpoint, keys) {
  if (!endpoint || typeof endpoint !== 'string' || endpoint.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') {
      return false;
    }
  } catch (_e) {
    return false;
  }

  if (!keys || typeof keys !== 'object') {
    return false;
  }
  const { p256dh, auth } = keys;
  if (!p256dh || typeof p256dh !== 'string' || p256dh.length < 64 || p256dh.length > 150) {
    return false;
  }
  if (!BASE64URL_REGEX.test(p256dh)) {
    return false;
  }
  if (!auth || typeof auth !== 'string' || auth.length < 16 || auth.length > 64) {
    return false;
  }
  if (!BASE64URL_REGEX.test(auth)) {
    return false;
  }

  return true;
}

/**
 * GET /api/push/public-key
 * Returns VAPID public key, or 503 PUSH_DISABLED if push is off.
 */
router.get('/public-key', authenticate, (req, res) => {
  const isPushEnabled = env.NOTIFY_CHANNELS.includes('push') && Boolean(env.VAPID_PUBLIC_KEY);
  if (!isPushEnabled) {
    return res.status(503).json({
      error: {
        code: 'PUSH_DISABLED',
        message: 'Push notifications are disabled on this server',
      },
    });
  }

  res.status(200).json({ publicKey: env.VAPID_PUBLIC_KEY });
});

/**
 * POST /api/push/subscriptions
 * Atomically upserts a subscription for the authenticated user, enforcing 5-device limit.
 */
router.post('/subscriptions', authenticate, async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};

    if (!validateSubscriptionPayload(endpoint, keys)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription endpoint or keys',
        },
      });
    }

    const sub = await PushSubscription.upsertForUser({
      userId: req.user.id,
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: req.headers['user-agent'] || '',
    });

    res.status(200).json({
      success: true,
      subscription: {
        id: sub._id,
        endpoint: sub.endpoint,
        lastSeenAt: sub.lastSeenAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/push/subscriptions
 * Idempotently deletes a subscription owned by the caller.
 */
router.delete('/subscriptions', authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Endpoint is required',
        },
      });
    }

    // Only delete if owned by the caller
    await PushSubscription.deleteOne({ endpoint, userId: req.user.id });

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/push/test
 * Sends a test notification to caller's registered devices. Rate limited to 1 call per 10s per user.
 */
router.post('/test', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = Date.now();
    const lastCall = testCallTimestamps.get(userId);

    if (lastCall && now - lastCall < 10000) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Please wait at least 10 seconds before requesting another test notification',
        },
      });
    }
    testCallTimestamps.set(userId, now);

    // Load caller's subscriptions
    const subs = await PushSubscription.find({ userId });
    const testNotification = {
      userId,
      tokenId: null,
      kind: 'test',
      title: 'SmartQueue Test Notification',
      body: 'Push notifications are working correctly on this device.',
    };

    const result = await pushChannel.sendToSubscriptions(subs, testNotification);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
