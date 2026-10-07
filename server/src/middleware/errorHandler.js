const AppError = require('../utils/AppError');

/**
 * Central Express error handling middleware.
 * Ensures uniform response shape: { error: { code, message, ...details } }
 */
function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    const errorPayload = {
      code: err.code,
      message: err.message,
      ...err.details,
    };
    return res.status(err.statusCode).json({ error: errorPayload });
  }

  // Handle JSON parse errors from body-parser
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON payload',
      },
    });
  }

  // Handle Mongoose cast errors or schema validation errors as 400 VALIDATION_ERROR
  if (err.name === 'CastError' || err.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
      },
    });
  }

  // Duplicate key errors (E11000) not translated in services are bugs and surface as 500
  console.error('Unhandled server error:', err);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
}

module.exports = errorHandler;
