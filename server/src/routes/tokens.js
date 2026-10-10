const express = require('express');
const { Token, Service, Counter } = require('../models');
const queueService = require('../services/queueService');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateObjectId } = require('../utils/validators');
const AppError = require('../utils/AppError');

const router = express.Router();

/**
 * Validates that a counter belongs to the authenticated staff/admin's organization.
 */
async function assertCounterOrganization(counterId, userOrganizationId) {
  const counter = await Counter.findById(counterId).populate('serviceId');
  if (!counter) {
    throw new AppError('COUNTER_NOT_FOUND', 404, 'Counter not found');
  }
  if (
    !counter.serviceId ||
    String(counter.serviceId.organizationId) !== String(userOrganizationId)
  ) {
    throw new AppError('FORBIDDEN', 403, 'Forbidden: counter belongs to another organization');
  }
  return counter;
}

/**
 * GET /api/tokens/:tokenId
 * Accessible to:
 * - The token owner (patient)
 * - Staff/Admin of the service's organization
 */
router.get('/:tokenId', authenticate, async (req, res, next) => {
  try {
    const { tokenId } = req.params;
    validateObjectId(tokenId, 'tokenId');

    const token = await Token.findById(tokenId);
    if (!token) {
      throw new AppError('TOKEN_NOT_FOUND', 404, 'Token not found');
    }

    const isOwner = String(token.userId) === String(req.user.id);
    if (!isOwner) {
      // Must be staff/admin of the token's service's organization
      const service = await Service.findById(token.serviceId);
      const isOrgStaff =
        service &&
        req.user.organizationId &&
        String(service.organizationId) === String(req.user.organizationId);

      if (!isOrgStaff) {
        throw new AppError('FORBIDDEN', 403, 'Forbidden: access denied to this token');
      }
    }

    const result = await queueService.getTokenStatus(tokenId);
    res.status(200).json({
      token: result.token,
      peopleAhead: result.peopleAhead,
      etaSeconds: result.etaSeconds,
      noShowInSec: result.noShowInSec,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tokens/:tokenId/start
 * Body: { counterId }
 * Staff/Admin only. Counter's service must belong to user's organization.
 */
router.post(
  '/:tokenId/start',
  authenticate,
  requireRole('staff', 'admin'),
  async (req, res, next) => {
    try {
      const { tokenId } = req.params;
      const { counterId } = req.body;

      validateObjectId(tokenId, 'tokenId');
      validateObjectId(counterId, 'counterId');

      await assertCounterOrganization(counterId, req.user.organizationId);

      const token = await queueService.startServing({ tokenId, counterId });
      res.status(200).json({ token });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/tokens/:tokenId/complete
 * Body: { counterId }
 * Staff/Admin only. Counter's service must belong to user's organization.
 */
router.post(
  '/:tokenId/complete',
  authenticate,
  requireRole('staff', 'admin'),
  async (req, res, next) => {
    try {
      const { tokenId } = req.params;
      const { counterId } = req.body;

      validateObjectId(tokenId, 'tokenId');
      validateObjectId(counterId, 'counterId');

      await assertCounterOrganization(counterId, req.user.organizationId);

      const token = await queueService.completeToken({ tokenId, counterId });
      res.status(200).json({ token });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/tokens/:tokenId/skip
 * Body: { counterId }
 * Staff/Admin only. Counter's service must belong to user's organization.
 */
router.post(
  '/:tokenId/skip',
  authenticate,
  requireRole('staff', 'admin'),
  async (req, res, next) => {
    try {
      const { tokenId } = req.params;
      const { counterId } = req.body;

      validateObjectId(tokenId, 'tokenId');
      validateObjectId(counterId, 'counterId');

      await assertCounterOrganization(counterId, req.user.organizationId);

      const token = await queueService.skipToken({ tokenId, counterId });
      res.status(200).json({ token });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/tokens/:tokenId/cancel
 * Owning patient only. userId is extracted directly from the verified JWT.
 */
router.post('/:tokenId/cancel', authenticate, async (req, res, next) => {
  try {
    const { tokenId } = req.params;
    validateObjectId(tokenId, 'tokenId');

    // userId is always taken from verified JWT token
    const token = await queueService.cancelToken({
      tokenId,
      userId: req.user.id,
    });

    res.status(200).json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
