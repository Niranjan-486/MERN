export const ERROR_MESSAGES = {
  QUEUE_EMPTY: 'No one is waiting',
  COUNTER_BUSY: 'Finish the current patient first',
  ALREADY_IN_QUEUE: 'You are already in this queue',
  INVALID_TRANSITION: 'That token just changed, refreshed',
  INVALID_OTP: 'Wrong code',
  UNAUTHENTICATED: 'Please log in to continue',
  FORBIDDEN: 'You are not authorized to perform this action',
  SERVICE_NOT_FOUND: 'Service not found',
  COUNTER_NOT_FOUND: 'Counter not found',
  TOKEN_NOT_FOUND: 'Token not found',
  SERVICE_INACTIVE: 'This service is currently inactive',
  COUNTER_NOT_ACTIVE: 'Counter is not active',
  USER_NOT_FOUND: 'User account not found',
  VALIDATION_ERROR: 'Please check your inputs and try again',
  RATE_LIMITED: 'Too many attempts. Please wait a minute.',
};

export const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.';

/**
 * Maps an error code or Error object to a user-friendly message.
 * Never displays raw error codes on screen.
 */
export function getFriendlyErrorMessage(err) {
  if (!err) return DEFAULT_ERROR_MESSAGE;

  const code = typeof err === 'string' ? err : err.code;
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }

  if (typeof err === 'object' && err.message && !err.code) {
    return err.message;
  }

  return DEFAULT_ERROR_MESSAGE;
}
