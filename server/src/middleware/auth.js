const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Signs a JWT with standard claims.
 * Expiry: 12h as specified in spec.
 */
function signToken(user) {
  const payload = {
    sub: user._id.toString(),
    role: user.role,
    organizationId: user.organizationId ? user.organizationId.toString() : null,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '12h' });
}

/**
 * Verifies a JWT and returns decoded payload.
 */
function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

/**
 * Express middleware to authenticate Bearer token.
 * Populates req.user with { id, role, organizationId }.
 */
function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('UNAUTHENTICATED', 401, 'Authentication token required'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      organizationId: decoded.organizationId || null,
    };
    next();
  } catch (_err) {
    next(new AppError('UNAUTHENTICATED', 401, 'Invalid or expired authentication token'));
  }
}

/**
 * Express middleware to restrict access to specific roles.
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('UNAUTHENTICATED', 401, 'Authentication required'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', 403, 'Insufficient permissions'));
    }
    next();
  };
}

module.exports = {
  signToken,
  verifyToken,
  authenticate,
  requireRole,
};
