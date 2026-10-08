const express = require('express');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const { sendOtp, verifyOtp } = require('../services/otpService');
const { signToken, authenticate } = require('../middleware/auth');
const AppError = require('../utils/AppError');

const router = express.Router();

// Rate-limit /api/auth/* to 10 requests per minute per IP (disabled in tests)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test' && !req.app?.get('enableRateLimitForTest'),
  handler: (_req, _res, next) => {
    next(
      new AppError(
        'RATE_LIMITED',
        429,
        'Too many authentication requests, please try again in a minute'
      )
    );
  },
});

router.use(authLimiter);

/**
 * Normalizes phone number to digits and checks length (10-13 digits).
 */
function normalizeAndValidatePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new AppError('VALIDATION_ERROR', 400, 'Phone number is required');
  }
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Invalid phone number: must be between 10 and 13 digits'
    );
  }
  return digits;
}

/**
 * Generates candidate phone representations for database lookup,
 * bridging 10-digit local, country-code prefixed (91), and E.164 (+) variations.
 */
function getPhoneCandidates(digits) {
  const set = new Set();
  set.add(digits);
  set.add(`+${digits}`);

  if (digits.length === 10) {
    set.add(`91${digits}`);
    set.add(`+91${digits}`);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    const local = digits.slice(2);
    set.add(local);
    set.add(`+${local}`);
  }

  return Array.from(set);
}

/**
 * Formats a User document for public API response.
 */
function formatUserResponse(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    phone: user.phone,
    role: user.role,
    organizationId: user.organizationId ? user.organizationId.toString() : null,
  };
}

/**
 * POST /api/auth/request-otp
 * Body: { phone }
 * Always returns { ok: true } without leaking phone registration status.
 */
router.post('/request-otp', async (req, res, next) => {
  try {
    const phone = normalizeAndValidatePhone(req.body.phone);
    await sendOtp(phone);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/verify-otp
 * Body: { phone, otp, name? }
 * Returns: { token, user }
 */
router.post('/verify-otp', async (req, res, next) => {
  try {
    const phone = normalizeAndValidatePhone(req.body.phone);
    const { otp, name } = req.body;

    if (!otp || typeof otp !== 'string') {
      throw new AppError('VALIDATION_ERROR', 400, 'OTP code is required');
    }

    // Check if user already exists across candidate phone variations
    const candidates = getPhoneCandidates(phone);
    let user = await User.findOne({ phone: { $in: candidates } });
    const role = user ? user.role : 'patient';

    const isValid = await verifyOtp(phone, otp, role);
    if (!isValid) {
      throw new AppError('INVALID_OTP', 401, 'Invalid OTP code');
    }

    if (!user) {
      // New phone: create patient via atomic upsert with $setOnInsert
      const defaultName =
        name && typeof name === 'string' && name.trim()
          ? name.trim()
          : `Patient ${phone.slice(-4)}`;

      const upsertPatient = async (retry = true) => {
        try {
          return await User.findOneAndUpdate(
            { phone },
            {
              $setOnInsert: {
                name: defaultName,
                role: 'patient', // Role is NEVER accepted from the client
                organizationId: null,
              },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
          );
        } catch (err) {
          if (err.code === 11000 && retry) {
            // Racing requests on unique phone index: retry once to retrieve inserted doc
            return upsertPatient(false);
          }
          throw err;
        }
      };

      user = await upsertPatient();
    }

    const token = signToken(user);
    res.status(200).json({
      token,
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = {
  router,
  formatUserResponse,
  normalizeAndValidatePhone,
};
