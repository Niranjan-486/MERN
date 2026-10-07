const express = require('express');
const { Counter, Service, Token } = require('../models');
const queueService = require('../services/queueService');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateObjectId } = require('../utils/validators');
const { getQueueDate } = require('../utils/queueDate');
const AppError = require('../utils/AppError');

const router = express.Router();

/**
 * GET /api/counters
 * Staff/Admin only.
 * Returns counters of the user's organization as:
 * [{ id, name, status, serviceId, serviceName, current: null | { tokenId, number, status } }]
 */
router.get('/', authenticate, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const services = await Service.find({ organizationId: req.user.organizationId }).lean();
    const serviceIds = services.map((s) => s._id);
    const serviceMap = new Map(services.map((s) => [s._id.toString(), s.name]));

    const counters = await Counter.find({ serviceId: { $in: serviceIds } }).lean();
    const today = getQueueDate();

    const activeTokens = await Token.find({
      counterId: { $in: counters.map((c) => c._id) },
      queueDate: today,
      isHoldingCounter: true,
    }).lean();

    const tokenMap = new Map(activeTokens.map((t) => [t.counterId.toString(), t]));

    const result = counters.map((c) => {
      const cur = tokenMap.get(c._id.toString());
      return {
        id: c._id.toString(),
        name: c.name,
        status: c.status,
        serviceId: c.serviceId.toString(),
        serviceName: serviceMap.get(c.serviceId.toString()) || '',
        current: cur
          ? {
              tokenId: cur._id.toString(),
              number: cur.number,
              status: cur.status,
            }
          : null,
      };
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/counters/:counterId/dashboard
 * Staff/Admin of that counter's organization, else 403.
 * Returns: {
 *   counter,
 *   service: { id, name },
 *   current: null | { tokenId, number, status, priority, patientName },
 *   waitingCount,
 *   waiting: [first 20 waiting tokens in call order, each { tokenId, number, priority, patientName }],
 *   nowServing: [same shape as in queue:updated]
 * }
 */
router.get(
  '/:counterId/dashboard',
  authenticate,
  requireRole('staff', 'admin'),
  async (req, res, next) => {
    try {
      const { counterId } = req.params;
      validateObjectId(counterId, 'counterId');

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

      const today = getQueueDate();

      // Current token for this counter (called or serving today)
      const curToken = await Token.findOne({
        counterId: counter._id,
        queueDate: today,
        isHoldingCounter: true,
      }).populate('userId', 'name');

      // Snapshot for waitingCount & nowServing
      const snapshot = await queueService.getQueueSnapshot(counter.serviceId._id, today);

      // First 20 waiting tokens in call order (priority desc, number asc)
      const waitingDocs = await Token.find({
        serviceId: counter.serviceId._id,
        queueDate: today,
        status: 'waiting',
      })
        .sort({ priority: -1, number: 1 })
        .limit(20)
        .populate('userId', 'name');

      const waiting = waitingDocs.map((t) => ({
        tokenId: t._id.toString(),
        number: t.number,
        priority: t.priority,
        patientName: t.userId ? t.userId.name : '',
      }));

      const current = curToken
        ? {
            tokenId: curToken._id.toString(),
            number: curToken.number,
            status: curToken.status,
            priority: curToken.priority,
            patientName: curToken.userId ? curToken.userId.name : '',
          }
        : null;

      res.status(200).json({
        counter: {
          id: counter._id.toString(),
          name: counter.name,
          status: counter.status,
          serviceId: counter.serviceId._id.toString(),
        },
        service: {
          id: counter.serviceId._id.toString(),
          name: counter.serviceId.name,
        },
        current,
        waitingCount: snapshot.waitingCount,
        waiting,
        nowServing: snapshot.nowServing,
      });
    } catch (err) {
      next(err);
    }
  }
);

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
