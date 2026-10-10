const { Notification, Token, Service } = require('../models');
const { getChannel } = require('./channels');
const env = require('../config/env');

/**
 * Generates user-facing notification title and body.
 * Keeps messages short, friendly, and includes position or counter name.
 */
function buildNotificationContent(kind, token, { serviceName, counterName } = {}) {
  const cName = counterName || (token.counterId && token.counterId.name ? token.counterId.name : null);
  const sName = serviceName || 'OPD Service';

  switch (kind) {
    case 'near':
      return {
        title: 'Your turn is coming up',
        body: `Token #${token.number}: You are next in line for ${sName}. Please stay near the waiting area.`,
      };
    case 'called':
      return {
        title: 'Your token has been called!',
        body: `Token #${token.number}: Please proceed to ${cName || 'Counter'}.`,
      };
    case 'no_show':
      return {
        title: 'Missed turn - Marked as no-show',
        body: `Token #${token.number} was marked as a no-show after waiting period expired.`,
      };
    default:
      return {
        title: `Queue update for token #${token.number}`,
        body: `Status update: ${kind}`,
      };
  }
}

/**
 * Checks if token status is still relevant for the notification kind:
 * - near needs waiting
 * - called needs called
 * - no_show needs no_show
 */
function isRelevant(kind, status) {
  if (kind === 'near') return status === 'waiting';
  if (kind === 'called') return status === 'called';
  if (kind === 'no_show') return status === 'no_show';
  return false;
}

/**
 * Processes a notification job for a token and notification kind.
 *
 * Guarantees:
 * a. Load token. If no longer relevant, mark Notification skipped and return.
 * b. Claim: insert Notification as pending. On duplicate-key error (tokenId, kind):
 *    - sent or skipped -> return (idempotent)
 *    - pending -> continue (earlier attempt failed or crashed), increment attempts
 * c. Deliver to each channel in NOTIFY_CHANNELS not yet in deliveredChannels,
 *    updating deliveredChannels with $addToSet after each succeeds.
 *    If any channel throws, the error propagates so BullMQ retries with backoff.
 *    When all channels delivered, status is marked 'sent'.
 */
async function processNotificationJob({ tokenId, kind }) {
  const token = await Token.findById(tokenId).populate('counterId', 'name');

  if (!token) {
    // Token was removed; record skipped if not already existing
    try {
      await Notification.create({
        tokenId,
        kind,
        title: 'Notification',
        body: 'Token not found',
        status: 'skipped',
        deliveredChannels: [],
        attempts: 1,
      });
    } catch (_err) {
      // Ignored if duplicate
    }
    return;
  }

  const service = await Service.findById(token.serviceId);
  const serviceName = service ? service.name : 'OPD Service';
  const counterName = token.counterId && token.counterId.name ? token.counterId.name : null;

  const { title, body } = buildNotificationContent(kind, token, {
    serviceName,
    counterName,
  });

  // a. If token is no longer relevant, record as skipped and return
  if (!isRelevant(kind, token.status)) {
    try {
      await Notification.create({
        userId: token.userId,
        tokenId: token._id,
        serviceId: token.serviceId,
        queueDate: token.queueDate,
        kind,
        title,
        body,
        status: 'skipped',
        deliveredChannels: [],
        attempts: 1,
      });
    } catch (err) {
      if (err.code === 11000) {
        // If already exists as pending, update to skipped
        await Notification.updateOne(
          { tokenId: token._id, kind, status: 'pending' },
          { $set: { status: 'skipped' } }
        );
      }
    }
    return;
  }

  // b. Claim: insert Notification as pending
  let notification;
  try {
    notification = await Notification.create({
      userId: token.userId,
      tokenId: token._id,
      serviceId: token.serviceId,
      queueDate: token.queueDate,
      kind,
      title,
      body,
      status: 'pending',
      deliveredChannels: [],
      attempts: 1,
    });
  } catch (err) {
    if (err.code === 11000) {
      notification = await Notification.findOne({ tokenId: token._id, kind });
      if (!notification) throw err;
      if (notification.status === 'sent' || notification.status === 'skipped') {
        // Idempotent: already terminal
        return;
      }
      // Pending: previous attempt failed or crashed; continue delivery
      notification = await Notification.findOneAndUpdate(
        { _id: notification._id },
        { $inc: { attempts: 1 } },
        { new: true }
      );
    } else {
      throw err;
    }
  }

  // c. Deliver to each channel in NOTIFY_CHANNELS not yet in deliveredChannels
  const channelNames = env.NOTIFY_CHANNELS || ['inapp', 'log'];
  for (const channelName of channelNames) {
    if (notification.deliveredChannels.includes(channelName)) {
      continue;
    }

    const channel = getChannel(channelName);
    if (!channel) {
      console.warn(`Channel "${channelName}" is not registered`);
      continue;
    }

    // Deliver. If this throws, BullMQ catches and retries!
    await channel.send(notification);

    // Record delivery atomically
    await Notification.updateOne(
      { _id: notification._id },
      { $addToSet: { deliveredChannels: channelName } }
    );
    notification.deliveredChannels.push(channelName);
  }

  // Set status sent when all channels are delivered
  await Notification.updateOne(
    { _id: notification._id },
    { $set: { status: 'sent', sentAt: new Date() } }
  );
}

module.exports = {
  processNotificationJob,
  buildNotificationContent,
};
