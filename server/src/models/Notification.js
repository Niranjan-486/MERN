const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Token',
      required: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    queueDate: {
      type: String,
      required: true,
    },
    kind: {
      type: String,
      required: true,
      enum: ['near', 'called', 'no_show'],
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'sent', 'skipped'],
      default: 'pending',
    },
    deliveredChannels: {
      type: [String],
      default: [],
    },
    attempts: {
      type: Number,
      default: 0,
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes
// 1. UNIQUE on (tokenId, kind) guarantees exactly-once notification delivery
notificationSchema.index({ tokenId: 1, kind: 1 }, { unique: true });

// 2. Query caller's recent notifications, newest first
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
