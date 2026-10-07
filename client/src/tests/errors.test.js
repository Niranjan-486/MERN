import { describe, test, expect } from 'vitest';
import { getFriendlyErrorMessage, DEFAULT_ERROR_MESSAGE } from '../lib/errors';

describe('errors.js mapping', () => {
  test('maps specified error codes to friendly messages', () => {
    expect(getFriendlyErrorMessage('QUEUE_EMPTY')).toBe('No one is waiting');
    expect(getFriendlyErrorMessage({ code: 'QUEUE_EMPTY' })).toBe('No one is waiting');

    expect(getFriendlyErrorMessage('COUNTER_BUSY')).toBe('Finish the current patient first');
    expect(getFriendlyErrorMessage({ code: 'COUNTER_BUSY' })).toBe('Finish the current patient first');

    expect(getFriendlyErrorMessage('ALREADY_IN_QUEUE')).toBe('You are already in this queue');
    expect(getFriendlyErrorMessage({ code: 'ALREADY_IN_QUEUE' })).toBe('You are already in this queue');

    expect(getFriendlyErrorMessage('INVALID_TRANSITION')).toBe('That token just changed, refreshed');
    expect(getFriendlyErrorMessage({ code: 'INVALID_TRANSITION' })).toBe('That token just changed, refreshed');

    expect(getFriendlyErrorMessage('INVALID_OTP')).toBe('Wrong code');
    expect(getFriendlyErrorMessage({ code: 'INVALID_OTP' })).toBe('Wrong code');
  });

  test('falls back to default error message for unknown error code or null', () => {
    expect(getFriendlyErrorMessage('SOME_RANDOM_CODE')).toBe(DEFAULT_ERROR_MESSAGE);
    expect(getFriendlyErrorMessage({ code: 'NON_EXISTENT' })).toBe(DEFAULT_ERROR_MESSAGE);
    expect(getFriendlyErrorMessage(null)).toBe(DEFAULT_ERROR_MESSAGE);
    expect(getFriendlyErrorMessage(undefined)).toBe(DEFAULT_ERROR_MESSAGE);
  });
});
