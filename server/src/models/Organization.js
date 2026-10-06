const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ['hospital', 'government', 'other'],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', organizationSchema);
