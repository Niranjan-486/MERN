const env = require('../config/env');

/**
 * OTP Service interface.
 * Currently a mock implementation for demo and testing without external SMS provider.
 * Keep behind this interface so a production SMS gateway (Twilio, AWS SNS, Fast2SMS)
 * and Redis-backed OTP store can replace it seamlessly.
 */

/**
 * Mock send OTP: in production, generates a cryptographically secure 6-digit code,
 * stores it with a TTL in Redis, and dispatches via SMS.
 * @param {string} phone
 * @returns {Promise<{ sent: boolean }>}
 */
async function sendOtp(_phone) {
  // No-op for mock — client uses configured demo codes
  return { sent: true };
}

/**
 * Verify OTP code against phone and role.
 * - Staff and Admin roles MUST match STAFF_OTP_CODE (min 8 chars, confidential).
 * - Patients and brand-new users are verified against OTP_CODE (public demo code).
 * This prevents public demo users from escalating privileges using the patient code.
 *
 * @param {string} phone
 * @param {string} code
 * @param {string} [role]
 * @returns {Promise<boolean>}
 */
async function verifyOtp(_phone, code, role) {
  if (!code || typeof code !== 'string') {
    return false;
  }

  if (role === 'staff' || role === 'admin') {
    return code === env.STAFF_OTP_CODE;
  }

  // Patients and brand-new users
  return code === env.OTP_CODE;
}

module.exports = {
  sendOtp,
  verifyOtp,
};
