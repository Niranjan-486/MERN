const webpush = require('web-push');
const { PushSubscription } = require('../../models');
const env = require('../../config/env');

let activeSender = null;

/**
 * Default web-push sender using credentials from env.
 */
async function defaultWebPushSender(sub, payload, options) {
  return webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    },
    payload,
    {
      TTL: options.TTL,
      urgency: options.urgency,
      topic: options.topic,
      timeout: options.timeout || 10000,
      vapidDetails: {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
    }
  );
}

/**
 * Builds the push payload and per-kind options.
 * Payloads carry title, body, kind, tokenId, tag, url, requireInteraction.
 * NO names or phone numbers are ever included.
 */
function buildPushPayloadAndOptions(notification) {
  const tokenIdStr = notification.tokenId ? notification.tokenId.toString() : null;
  const tag = tokenIdStr ? `token-${tokenIdStr}` : 'test';
  const topic = tokenIdStr ? `t${tokenIdStr}` : 'test';
  const requireInteraction = notification.kind === 'called';

  const payload = JSON.stringify({
    title: notification.title || 'Queue Update',
    body: notification.body || '',
    kind: notification.kind || 'update',
    tokenId: tokenIdStr,
    tag,
    url: '/',
    requireInteraction,
  });

  let TTL = 600;
  let urgency = 'normal';

  switch (notification.kind) {
    case 'near':
      TTL = 600;
      urgency = 'high';
      break;
    case 'called':
      // Stale once no-show grace period elapses
      TTL = env.NO_SHOW_GRACE_SECONDS || 180;
      urgency = 'high';
      break;
    case 'no_show':
      TTL = 3600;
      urgency = 'normal';
      break;
    case 'test':
      TTL = 60;
      urgency = 'normal';
      break;
    default:
      TTL = 600;
      urgency = 'normal';
      break;
  }

  const options = {
    TTL,
    urgency,
    topic,
    timeout: 10000,
  };

  return { payload, options };
}

/**
 * Web Push notification channel.
 * Implements resilient multi-device delivery with automatic subscription pruning.
 */
const pushChannel = {
  name: 'push',

  async send(notification) {
    if (!notification || !notification.userId) {
      return;
    }

    const subscriptions = await PushSubscription.find({ userId: notification.userId });
    if (!subscriptions || subscriptions.length === 0) {
      // Nothing to deliver is not an error
      return;
    }

    const { payload, options } = buildPushPayloadAndOptions(notification);
    const sender = activeSender || defaultWebPushSender;

    const results = await Promise.allSettled(
      subscriptions.map((sub) => sender(sub, payload, options))
    );

    let successCount = 0;
    let goneCount = 0;
    let retryableFailures = [];

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const sub = subscriptions[i];

      if (res.status === 'fulfilled') {
        successCount += 1;
        // Reset failure count, update lastSeenAt
        await PushSubscription.updateOne(
          { _id: sub._id },
          { $set: { failureCount: 0, lastSeenAt: new Date() } }
        ).catch(() => {});
      } else {
        const err = res.reason || {};
        const statusCode = err.statusCode || (err.response && err.response.statusCode);

        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone: delete it
          goneCount += 1;
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        } else {
          // Retryable / server failure
          retryableFailures.push(err);
          const nextFailureCount = (sub.failureCount || 0) + 1;
          if (nextFailureCount >= 5) {
            // Consecutive failures threshold reached -> prune
            await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
          } else {
            await PushSubscription.updateOne(
              { _id: sub._id },
              { $inc: { failureCount: 1 } }
            ).catch(() => {});
          }
        }
      }
    }

    // Outcome determination:
    // - At least one succeeded -> resolve (partial success counts as delivered)
    // - All gone/unregistered -> resolve
    // - Throw ONLY if every non-gone attempt failed retryably
    if (successCount > 0) {
      return;
    }

    if (retryableFailures.length > 0) {
      const lastErr = retryableFailures[0];
      const err = new Error(
        `Push delivery failed for all ${subscriptions.length} device(s): ${lastErr.message || 'Network/Server Error'}`
      );
      err.retryable = true;
      throw err;
    }

    // All subscriptions were gone (404/410)
    return;
  },

  /**
   * Helper to send directly to specific subscriptions (used by POST /api/push/test).
   */
  async sendToSubscriptions(subscriptions, notification) {
    if (!subscriptions || subscriptions.length === 0) {
      return { sent: 0, removed: 0, failed: 0 };
    }

    const { payload, options } = buildPushPayloadAndOptions(notification);
    const sender = activeSender || defaultWebPushSender;

    const results = await Promise.allSettled(
      subscriptions.map((sub) => sender(sub, payload, options))
    );

    let sent = 0;
    let removed = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const sub = subscriptions[i];

      if (res.status === 'fulfilled') {
        sent += 1;
        await PushSubscription.updateOne(
          { _id: sub._id },
          { $set: { failureCount: 0, lastSeenAt: new Date() } }
        ).catch(() => {});
      } else {
        const err = res.reason || {};
        const statusCode = err.statusCode || (err.response && err.response.statusCode);

        if (statusCode === 404 || statusCode === 410) {
          removed += 1;
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        } else {
          failed += 1;
          const nextCount = (sub.failureCount || 0) + 1;
          if (nextCount >= 5) {
            removed += 1;
            await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
          } else {
            await PushSubscription.updateOne(
              { _id: sub._id },
              { $inc: { failureCount: 1 } }
            ).catch(() => {});
          }
        }
      }
    }

    return { sent, removed, failed };
  },

  /**
   * Injectable sender helper for testing without network requests.
   */
  setSender(fn) {
    activeSender = fn;
  },

  resetSender() {
    activeSender = null;
  },
};

module.exports = pushChannel;
