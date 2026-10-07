/**
 * Operational application error with specific code, HTTP status code, and optional details.
 */
class AppError extends Error {
  /**
   * @param {string} code - Error code (e.g. VALIDATION_ERROR, ALREADY_IN_QUEUE)
   * @param {number} statusCode - HTTP status code (400, 403, 404, 409, 500)
   * @param {string} message - Descriptive error message
   * @param {object} [details={}] - Additional data (e.g. existing active token)
   */
  constructor(code, statusCode, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
