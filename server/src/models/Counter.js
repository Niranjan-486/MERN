const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: ['active', 'paused', 'offline'],
      default: 'offline',
    },
    currentTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Token',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Counter', counterSchema);
