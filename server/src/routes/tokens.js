const express = require('express');
const queueService = require('../services/queueService');
const { validateObjectId } = require('../utils/validators');

const router = express.Router();

/**
 * GET /api/tokens/:tokenId
 */
router.get('/:tokenId', async (req, res, next) => {
  try {
    const { tokenId } = req.params;
    validateObjectId(tokenId, 'tokenId');

    const result = await queueService.getTokenStatus(tokenId);
    res.status(200).json({
      token: result.token,
      peopleAhead: result.peopleAhead,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tokens/:tokenId/start
 * Body: { counterId }
 */
router.post('/:tokenId/start', async (req, res, next) => {
  try {
    const { tokenId } = req.params;
    const { counterId } = req.body;

    validateObjectId(tokenId, 'tokenId');
    validateObjectId(counterId, 'counterId');

    const token = await queueService.startServing({ tokenId, counterId });
    res.status(200).json({ token });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tokens/:tokenId/complete
 * Body: { counterId }
 */
router.post('/:tokenId/complete', async (req, res, next) => {
  try {
    const { tokenId } = req.params;
    const { counterId } = req.body;

    validateObjectId(tokenId, 'tokenId');
    validateObjectId(counterId, 'counterId');

    const token = await queueService.completeToken({ tokenId, counterId });
    res.status(200).json({ token });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tokens/:tokenId/skip
 * Body: { counterId }
 */
router.post('/:tokenId/skip', async (req, res, next) => {
  try {
    const { tokenId } = req.params;
    const { counterId } = req.body;

    validateObjectId(tokenId, 'tokenId');
    validateObjectId(counterId, 'counterId');

    const token = await queueService.skipToken({ tokenId, counterId });
    res.status(200).json({ token });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tokens/:tokenId/cancel
 * Body: { userId }
 */
router.post('/:tokenId/cancel', async (req, res, next) => {
  try {
    const { tokenId } = req.params;
    const { userId } = req.body;

    validateObjectId(tokenId, 'tokenId');
    validateObjectId(userId, 'userId');

    const token = await queueService.cancelToken({ tokenId, userId });
    res.status(200).json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
