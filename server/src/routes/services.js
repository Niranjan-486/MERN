const express = require('express');
const { Service, User } = require('../models');
const queueService = require('../services/queueService');
const { authenticate } = require('../middleware/auth');
const { validateObjectId, validatePriority } = require('../utils/validators');
const AppError = require('../utils/AppError');

const router = express.Router();

/**
 * POST /api/services/:serviceId/tokens
 * - Patient: userId is forced to req.user.id, priority forced to 0.
 * - Staff/Admin: can supply { userId, priority } for an existing patient,
 *   only for services belonging to their own organization.
 */
router.post('/:serviceId/tokens', authenticate, async (req, res, next) => {
  try {
    const { serviceId } = req.params;
    validateObjectId(serviceId, 'serviceId');

    let targetUserId;
    let targetPriority = 0;

    if (req.user.role === 'patient') {
      // Patient cannot self-assign emergency; userId always taken from JWT
      targetUserId = req.user.id;
      targetPriority = 0;
    } else {
      // Staff or Admin user
      const service = await Service.findById(serviceId);
      if (!service) {
        throw new AppError('SERVICE_NOT_FOUND', 404, 'Service not found');
      }
      if (String(service.organizationId) !== String(req.user.organizationId)) {
        throw new AppError('FORBIDDEN', 403, 'Forbidden: service belongs to another organization');
      }

      targetUserId = req.body.userId || req.user.id;
      validateObjectId(targetUserId, 'userId');

      const existingPatient = await User.findById(targetUserId);
      if (!existingPatient) {
        throw new AppError('USER_NOT_FOUND', 404, 'Patient user not found');
      }

      if (req.body.priority !== undefined) {
        targetPriority = Number(req.body.priority);
        validatePriority(targetPriority);
      }
    }

    const token = await queueService.joinQueue({
      serviceId,
      userId: targetUserId,
      priority: targetPriority,
    });

    res.status(201).json({ token });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/services/:serviceId/queue
 * Returns full queue state snapshot for today (waitingCount + nowServing).
 * Accessible to any authenticated user (contains no personal patient data).
 */
router.get('/:serviceId/queue', authenticate, async (req, res, next) => {
  try {
    const { serviceId } = req.params;
    validateObjectId(serviceId, 'serviceId');

    const service = await Service.findById(serviceId);
    if (!service) {
      throw new AppError('SERVICE_NOT_FOUND', 404, 'Service not found');
    }

    const snapshot = await queueService.getQueueSnapshot(serviceId);
    res.status(200).json({
      serviceId: snapshot.serviceId,
      queueDate: snapshot.queueDate,
      waitingCount: snapshot.waitingCount,
      nowServing: snapshot.nowServing,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
