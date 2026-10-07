const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    number: { type: Number, required: true },
    queueDate: { type: String, required: true }, // 'YYYY-MM-DD'
    status: {
      type: String,
      required: true,
      enum: ['waiting', 'called', 'serving', 'completed', 'skipped', 'no_show', 'cancelled'],
      default: 'waiting',
    },
    priority: {
      type: Number,
      required: true,
      enum: [0, 1, 2], // 0 normal, 1 senior citizen, 2 emergency
      default: 0,
    },
    counterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counter',
      default: null,
    },
    // isActive: true for waiting, called, serving (managed by state machine)
    isActive: { type: Boolean, default: true },
    // isHoldingCounter: true for called, serving (managed by state machine)
    isHoldingCounter: { type: Boolean, default: false },
    joinedAt: { type: Date, default: null },
    calledAt: { type: Date, default: null },
    servingAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// --- Indexes ---

// 1. No two tokens share the same number on the same service+date
tokenSchema.index({ serviceId: 1, queueDate: 1, number: 1 }, { unique: true });

// 2. One person can only hold one active token per service per day.
//    Includes queueDate so leftover tokens from previous days do not block today.
tokenSchema.index(
  { serviceId: 1, queueDate: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
  }
);

// 3. A counter must never hold two called/serving tokens on the same day.
tokenSchema.index(
  { counterId: 1, queueDate: 1 },
  {
    unique: true,
    partialFilterExpression: { isHoldingCounter: true },
  }
);

// 4. "Next in line" query: find waiting tokens sorted by priority desc, number asc
tokenSchema.index({
  serviceId: 1,
  queueDate: 1,
  status: 1,
  priority: -1,
  number: 1,
});

module.exports = mongoose.model('Token', tokenSchema);
