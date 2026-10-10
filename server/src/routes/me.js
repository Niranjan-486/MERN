const express = require('express');
const { User, Token, Notification } = require('../models');
const { authenticate } = require('../middleware/auth');
const { formatUserResponse } = require('./auth');
const { getQueueDate } = require('../utils/queueDate');
const queueService = require('../services/queueService');
const env = require('../config/env');
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
    const graceMs = (env.NO_SHOW_GRACE_SECONDS || 180) * 1000;
    const now = Date.now();

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

        const isCalled = t.status === 'called';
        const noShowInSec =
          isCalled && t.calledAt
            ? Math.max(0, Math.round((new Date(t.calledAt).getTime() + graceMs - now) / 1000))
            : null;

        return {
          tokenId: t._id.toString(),
          serviceId: t.serviceId.toString(),
          number: t.number,
          status: t.status,
          priority: t.priority,
          peopleAhead,
          counterName: (t.counterId && t.counterId.name) || null,
          etaSeconds,
          noShowInSec,
        };
      })
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/me/notifications
 * Returns caller's notifications for today, newest first, max 20.
 */
router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    const queueDate = getQueueDate();
    const notifications = await Notification.find({
      userId: req.user.id,
      queueDate,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    const formatted = notifications.map((n) => ({
      id: n._id.toString(),
      tokenId: n.tokenId.toString(),
      serviceId: n.serviceId.toString(),
      kind: n.kind,
      title: n.title,
      body: n.body,
      status: n.status,
      deliveredChannels: n.deliveredChannels,
      attempts: n.attempts,
      sentAt: n.sentAt,
      createdAt: n.createdAt,
    }));

    res.status(200).json(formatted);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
