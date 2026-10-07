const express = require('express');
const { Service, User, Token } = require('../models');
const queueService = require('../services/queueService');
const { authenticate } = require('../middleware/auth');
const { validateObjectId, validatePriority } = require('../utils/validators');
const { getQueueDate } = require('../utils/queueDate');
const AppError = require('../utils/AppError');

const router = express.Router();

/**
 * GET /api/services
 * Any authenticated user.
 * Returns active services as [{ id, name, organizationName, waitingCount }],
 * where waitingCount is today's number of waiting tokens.
 * Computed with ONE aggregation, not one query per service.
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const today = getQueueDate();
    const [services, counts] = await Promise.all([
      Service.find({ isActive: true }).populate('organizationId', 'name').lean(),
      Token.aggregate([
        { $match: { queueDate: today, status: 'waiting' } },
        { $group: { _id: '$serviceId', count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    const result = services.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      organizationName: s.organizationId ? s.organizationId.name : '',
      waitingCount: countMap.get(s._id.toString()) || 0,
    }));

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

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
