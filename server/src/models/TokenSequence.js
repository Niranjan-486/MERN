const mongoose = require('mongoose');

const tokenSequenceSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    queueDate: { type: String, required: true }, // 'YYYY-MM-DD'
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One sequence counter per service per day
tokenSequenceSchema.index({ serviceId: 1, queueDate: 1 }, { unique: true });

module.exports = mongoose.model('TokenSequence', tokenSequenceSchema);
