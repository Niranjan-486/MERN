const mongoose = require('mongoose');

const PushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      maxlength: 2048,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
      },
      auth: {
        type: String,
        required: true,
      },
    },
    userAgent: {
      type: String,
      default: '',
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Atomically upserts a push subscription keyed by endpoint.
 * - Reassigns userId to the current caller (handles shared devices).
 * - Refreshes keys, userAgent, lastSeenAt, and resets failureCount to 0.
 * - Enforces the 5-device limit per user by pruning the oldest subscriptions beyond 5.
 */
PushSubscriptionSchema.statics.upsertForUser = async function ({
  userId,
  endpoint,
  keys,
  userAgent = '',
}) {
  const sub = await this.findOneAndUpdate(
    { endpoint },
    {
      $set: {
        userId,
        'keys.p256dh': keys.p256dh,
        'keys.auth': keys.auth,
        userAgent: userAgent || '',
        lastSeenAt: new Date(),
        failureCount: 0,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  // Prune any subscriptions beyond 5 for this user (oldest first by updatedAt)
  const userSubs = await this.find({ userId }).sort({ updatedAt: -1 });
  if (userSubs.length > 5) {
    const idsToDelete = userSubs.slice(5).map((s) => s._id);
    await this.deleteMany({ _id: { $in: idsToDelete } });
  }

  return sub;
};

const PushSubscription = mongoose.model('PushSubscription', PushSubscriptionSchema);

module.exports = PushSubscription;
