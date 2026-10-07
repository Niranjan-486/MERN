const mongoose = require('mongoose');
const AppError = require('./AppError');

/**
 * Validates a MongoDB ObjectId string.
 */
function validateObjectId(id, fieldName = 'id') {
  if (
    !id ||
    typeof id !== 'string' ||
    !mongoose.Types.ObjectId.isValid(id) ||
    String(new mongoose.Types.ObjectId(id)) !== String(id)
  ) {
    throw new AppError('VALIDATION_ERROR', 400, `Invalid ${fieldName}`);
  }
}

/**
 * Validates token priority (0, 1, 2).
 */
function validatePriority(priority) {
  if (priority !== undefined) {
    const num = Number(priority);
    if (!Number.isInteger(num) || ![0, 1, 2].includes(num)) {
      throw new AppError('VALIDATION_ERROR', 400, 'Priority must be 0, 1, or 2');
    }
  }
}

module.exports = {
  validateObjectId,
  validatePriority,
};
