const express = require('express');
const queueService = require('../services/queueService');
const { validateObjectId, validatePriority } = require('../utils/validators');

const router = express.Router();

/**
 * POST /api/services/:serviceId/tokens
 * Body: { userId, priority? }
 */
router.post('/:serviceId/tokens', async (req, res, next) => {
  try {
    const { serviceId } = req.params;
    const { userId, priority } = req.body;

    validateObjectId(serviceId, 'serviceId');
    validateObjectId(userId, 'userId');
    validatePriority(priority);

    const token = await queueService.joinQueue({
      serviceId,
      userId,
      priority: priority !== undefined ? Number(priority) : 0,
    });

    res.status(201).json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
