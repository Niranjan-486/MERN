const express = require('express');
const { User, Token } = require('../models');
const { authenticate } = require('../middleware/auth');
const { formatUserResponse } = require('./auth');
const { getQueueDate } = require('../utils/queueDate');
const queueService = require('../services/queueService');
const AppError = require('../utils/AppError');

const router = express.Router();

/**
 * GET /api/me
 * Returns authenticated user profile.
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 404, 'User not found');
    }
    res.status(200).json({
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/me/tokens/active
 * Returns all active tokens of the user for today in the same shape as token:updated.
 * Single source of truth for clients reconnecting.
 */
router.get('/tokens/active', authenticate, async (req, res, next) => {
  try {
    const queueDate = getQueueDate();
    const activeTokens = await Token.find({
      userId: req.user.id,
      queueDate,
      isActive: true,
    }).populate('counterId', 'name');

    const result = await Promise.all(
      activeTokens.map(async (t) => {
        let peopleAhead = null;
        let etaSeconds = null;
        if (t.status === 'waiting') {
          const statusInfo = await queueService.getTokenStatus(t._id);
          peopleAhead = statusInfo.peopleAhead;
          etaSeconds = statusInfo.etaSeconds;
        }

        return {
          tokenId: t._id.toString(),
          serviceId: t.serviceId.toString(),
          number: t.number,
          status: t.status,
          priority: t.priority,
          peopleAhead,
          counterName: (t.counterId && t.counterId.name) || null,
          etaSeconds,
        };
      })
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
