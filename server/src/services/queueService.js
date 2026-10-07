const { Service, Counter, Token, TokenSequence } = require('../models');
const {
  assertTransition,
  isActiveStatus,
  isHoldingCounterStatus,
} = require('./tokenStateMachine');
const { getQueueDate } = require('../utils/queueDate');
const AppError = require('../utils/AppError');

/**
 * Allocates the next token number for a service on a given queueDate.
 * Uses atomic findOneAndUpdate with $inc and upsert on TokenSequence.
 * Retries once if initial document creation races produce E11000.
 */
async function allocateTokenNumber(serviceId, queueDate, retry = true) {
  try {
    const sequence = await TokenSequence.findOneAndUpdate(
      { serviceId, queueDate },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return sequence.seq;
  } catch (err) {
    if (err.code === 11000 && retry) {
      return allocateTokenNumber(serviceId, queueDate, false);
    }
    throw err;
  }
}

/**
 * Shared atomic transition helper for status changes.
 * 1. Checks state-machine transition legality.
 * 2. Runs ONE atomic findOneAndUpdate with expected status in filter.
 * 3. If update matches nothing, runs follow-up read ONLY to diagnose error code:
 *    TOKEN_NOT_FOUND, FORBIDDEN, or INVALID_TRANSITION.
 */
async function transitionToken({
  tokenId,
  expectedStatuses,
  nextStatus,
  counterId,
  userId,
  updateFields = {},
}) {
  // Check legality of transition for every allowed source status
  for (const expected of expectedStatuses) {
    assertTransition(expected, nextStatus);
  }

  // Filter requires expected status and authorization identity
  const filter = { _id: tokenId };
  if (expectedStatuses.length === 1) {
    filter.status = expectedStatuses[0];
  } else {
    filter.status = { $in: expectedStatuses };
  }

  if (counterId) {
    filter.counterId = counterId;
  }
  if (userId) {
    filter.userId = userId;
  }

  const update = {
    status: nextStatus,
    isActive: isActiveStatus(nextStatus),
    isHoldingCounter: isHoldingCounterStatus(nextStatus),
    ...updateFields,
  };

  const token = await Token.findOneAndUpdate(filter, { $set: update }, { new: true });

  if (token) {
    // Keep Counter.currentTokenId updated as convenience (never used for correctness)
    if (counterId) {
      if (nextStatus === 'serving') {
        await Counter.updateOne({ _id: counterId }, { currentTokenId: token._id });
      } else if (nextStatus === 'completed' || nextStatus === 'skipped') {
        await Counter.updateOne(
          { _id: counterId, currentTokenId: token._id },
          { currentTokenId: null }
        );
      }
    } else if (userId && token.counterId) {
      // If cancelled while called, clear counter's current token pointer
      await Counter.updateOne(
        { _id: token.counterId, currentTokenId: token._id },
        { currentTokenId: null }
      );
    }
    return token;
  }

  // Atomic update matched nothing — follow-up read only for error diagnostics
  const existing = await Token.findById(tokenId);
  if (!existing) {
    throw new AppError('TOKEN_NOT_FOUND', 404, 'Token not found');
  }

  // Check user authorization if userId was supplied
  if (userId && String(existing.userId) !== String(userId)) {
    throw new AppError('FORBIDDEN', 403, 'You are not authorized to cancel this token');
  }

  // Check valid status transition
  if (!expectedStatuses.includes(existing.status)) {
    throw new AppError(
      'INVALID_TRANSITION',
      409,
      `Cannot transition token from status "${existing.status}" to "${nextStatus}"`
    );
  }

  // Check counter authorization if counterId was supplied
  if (counterId && String(existing.counterId) !== String(counterId)) {
    throw new AppError('FORBIDDEN', 403, 'Token is assigned to another counter');
  }

  throw new AppError('INVALID_TRANSITION', 409, 'Token cannot be transitioned');
}

/**
 * Join queue service: allocates number atomically, inserts token with waiting status.
 */
async function joinQueue({ serviceId, userId, priority = 0 }) {
  const service = await Service.findById(serviceId);
  if (!service) {
    throw new AppError('SERVICE_NOT_FOUND', 404, 'Service not found');
  }
  if (!service.isActive) {
    throw new AppError('SERVICE_INACTIVE', 409, 'Service is inactive');
  }

  const queueDate = getQueueDate();
  const tokenNumber = await allocateTokenNumber(serviceId, queueDate);

  try {
    const token = await Token.create({
      serviceId,
      userId,
      number: tokenNumber,
      queueDate,
      status: 'waiting',
      priority,
      counterId: null,
      isActive: true,
      isHoldingCounter: false,
      joinedAt: new Date(),
    });
    return token;
  } catch (err) {
    // Check if duplicate key violation was on the per-user active token index
    if (err.code === 11000 && err.keyPattern && err.keyPattern.userId) {
      const existingToken = await Token.findOne({
        serviceId,
        queueDate,
        userId,
        isActive: true,
      });
      throw new AppError(
        'ALREADY_IN_QUEUE',
        409,
        'User already has an active token in this service today',
        { token: existingToken }
      );
    }
    // Any other duplicate key error is a bug
    throw err;
  }
}

/**
 * Get token status and number of waiting people ahead of it.
 */
async function getTokenStatus(tokenId) {
  const token = await Token.findById(tokenId);
  if (!token) {
    throw new AppError('TOKEN_NOT_FOUND', 404, 'Token not found');
  }

  let peopleAhead = 0;
  if (token.status === 'waiting') {
    peopleAhead = await Token.countDocuments({
      serviceId: token.serviceId,
      queueDate: token.queueDate,
      status: 'waiting',
      $or: [
        { priority: { $gt: token.priority } },
        { priority: token.priority, number: { $lt: token.number } },
      ],
    });
  }

  const tokenObj = token.toObject();
  return {
    ...tokenObj,
    token: tokenObj,
    peopleAhead,
  };
}

/**
 * Call the next waiting token for a counter.
 * ONE atomic findOneAndUpdate ordered by priority desc, number asc.
 * Partial unique index on (counterId, queueDate) where isHoldingCounter=true
 * prevents a counter from holding two active tokens.
 */
async function callNext({ counterId }) {
  const counter = await Counter.findById(counterId);
  if (!counter) {
    throw new AppError('COUNTER_NOT_FOUND', 404, 'Counter not found');
  }
  if (counter.status !== 'active') {
    throw new AppError('COUNTER_NOT_ACTIVE', 409, 'Counter is not active');
  }

  assertTransition('waiting', 'called');

  const queueDate = getQueueDate();

  let token;
  try {
    token = await Token.findOneAndUpdate(
      {
        serviceId: counter.serviceId,
        queueDate,
        status: 'waiting',
      },
      {
        $set: {
          status: 'called',
          counterId: counter._id,
          isHoldingCounter: true,
          calledAt: new Date(),
        },
      },
      {
        sort: { priority: -1, number: 1 },
        new: true,
      }
    );
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.counterId) {
      throw new AppError('COUNTER_BUSY', 409, 'Counter is already serving or calling a token');
    }
    throw err;
  }

  if (!token) {
    // If no waiting tokens matched, check if counter is already holding an active token
    const busyToken = await Token.findOne({
      counterId: counter._id,
      queueDate,
      isHoldingCounter: true,
    });
    if (busyToken) {
      throw new AppError('COUNTER_BUSY', 409, 'Counter is already serving or calling a token');
    }
    throw new AppError('QUEUE_EMPTY', 409, 'Queue is empty');
  }

  // Update counter currentTokenId as convenience
  await Counter.updateOne({ _id: counter._id }, { currentTokenId: token._id });

  return token;
}

/**
 * Start serving a called token: called -> serving
 */
async function startServing({ tokenId, counterId }) {
  return transitionToken({
    tokenId,
    expectedStatuses: ['called'],
    nextStatus: 'serving',
    counterId,
    updateFields: { servingAt: new Date() },
  });
}

/**
 * Complete a serving token: serving -> completed
 */
async function completeToken({ tokenId, counterId }) {
  return transitionToken({
    tokenId,
    expectedStatuses: ['serving'],
    nextStatus: 'completed',
    counterId,
    updateFields: { completedAt: new Date() },
  });
}

/**
 * Skip a called token: called -> skipped
 */
async function skipToken({ tokenId, counterId }) {
  return transitionToken({
    tokenId,
    expectedStatuses: ['called'],
    nextStatus: 'skipped',
    counterId,
  });
}

/**
 * Cancel a waiting or called token: waiting | called -> cancelled
 */
async function cancelToken({ tokenId, userId }) {
  return transitionToken({
    tokenId,
    expectedStatuses: ['waiting', 'called'],
    nextStatus: 'cancelled',
    userId,
  });
}

module.exports = {
  joinQueue,
  getTokenStatus,
  callNext,
  startServing,
  completeToken,
  skipToken,
  cancelToken,
  transitionToken,
};
