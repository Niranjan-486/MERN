const express = require('express');
const queueService = require('../services/queueService');
const { validateObjectId } = require('../utils/validators');

const router = express.Router();

/**
 * POST /api/counters/:counterId/call-next
 */
router.post('/:counterId/call-next', async (req, res, next) => {
  try {
    const { counterId } = req.params;
    validateObjectId(counterId, 'counterId');

    const token = await queueService.callNext({ counterId });
    res.status(200).json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
