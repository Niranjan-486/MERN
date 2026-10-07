const express = require('express');
const { Counter } = require('../models');
const queueService = require('../services/queueService');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateObjectId } = require('../utils/validators');
const AppError = require('../utils/AppError');

const router = express.Router();

/**
 * POST /api/counters/:counterId/call-next
 * Staff/Admin only. Counter's service must belong to user's organization.
 */
router.post(
  '/:counterId/call-next',
  authenticate,
  requireRole('staff', 'admin'),
  async (req, res, next) => {
    try {
      const { counterId } = req.params;
      validateObjectId(counterId, 'counterId');

      // Verify counter exists and belongs to the staff member's organization
      const counter = await Counter.findById(counterId).populate('serviceId');
      if (!counter) {
        throw new AppError('COUNTER_NOT_FOUND', 404, 'Counter not found');
      }
      if (
        !counter.serviceId ||
        String(counter.serviceId.organizationId) !== String(req.user.organizationId)
      ) {
        throw new AppError('FORBIDDEN', 403, 'Forbidden: counter belongs to another organization');
      }

      const token = await queueService.callNext({ counterId });
      res.status(200).json({ token });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
