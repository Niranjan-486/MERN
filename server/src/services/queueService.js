const { Service, Counter, Token, TokenSequence } = require('../models');
const {
  assertTransition,
  isActiveStatus,
  isHoldingCounterStatus,
} = require('./tokenStateMachine');
const { getQueueDate } = require('../utils/queueDate');
const { publishTokenChanged } = require('../events/eventBus');
const { computeEtas } = require('./etaService');
const env = require('../config/env');
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
 * 4. Publishes 'tokenChanged' domain event on success.
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

    // Publish domain event ONLY after DB write succeeds
    publishTokenChanged({
      serviceId: token.serviceId,
      queueDate: token.queueDate,
      tokenId: token._id,
      userId: token.userId,
      status: token.status,
    });

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

    // Publish domain event ONLY after DB write succeeds
    publishTokenChanged({
      serviceId: token.serviceId,
      queueDate: token.queueDate,
      tokenId: token._id,
      userId: token.userId,
      status: token.status,
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
 * Get token status, number of waiting people ahead of it, and etaSeconds.
 * For waiting tokens, uses getQueueSnapshot so snapshot ETAs and getTokenStatus ETAs
 * are guaranteed to agree.
 */
async function getTokenStatus(tokenId) {
  const token = await Token.findById(tokenId);
  if (!token) {
    throw new AppError('TOKEN_NOT_FOUND', 404, 'Token not found');
  }

  let peopleAhead = 0;
  let etaSeconds = null;

  if (token.status === 'waiting') {
    const snapshot = await getQueueSnapshot(token.serviceId, token.queueDate);
    const waitingList = snapshot.waitingTokens;
    const tokenIndex = waitingList.findIndex(
      (t) => (t._id || t.id).toString() === token._id.toString()
    );

    if (tokenIndex !== -1) {
      peopleAhead = tokenIndex;
      etaSeconds = waitingList[tokenIndex].etaSeconds ?? null;
    } else {
      peopleAhead = await Token.countDocuments({
        serviceId: token.serviceId,
        queueDate: token.queueDate,
        status: 'waiting',
        $or: [
          { priority: { $gt: token.priority } },
          { priority: token.priority, number: { $lt: token.number } },
        ],
      });
      etaSeconds = null;
    }
  }

  let noShowInSec = null;
  if (token.status === 'called' && token.calledAt) {
    const graceMs = (env.NO_SHOW_GRACE_SECONDS || 180) * 1000;
    noShowInSec = Math.max(
      0,
      Math.round((new Date(token.calledAt).getTime() + graceMs - Date.now()) / 1000)
    );
  }

  const tokenObj = {
    ...token.toObject(),
    etaSeconds,
    noShowInSec,
  };

  return {
    ...tokenObj,
    token: tokenObj,
    peopleAhead,
    etaSeconds,
    noShowInSec,
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

  // Publish domain event ONLY after DB write succeeds
  publishTokenChanged({
    serviceId: token.serviceId,
    queueDate: token.queueDate,
    tokenId: token._id,
    userId: token.userId,
    status: token.status,
  });

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
 * Updates Service.avgServiceTimeSec and serviceSamples using ONE atomic
 * aggregation-pipeline update (no read-then-write race).
 *
 * Rules:
 * - sample: completedAt - servingAt in seconds.
 * - sample < 10 s: ignored completely (no change to avg or samples).
 * - cap sample at 3x current average (prevents forgotten Complete click from wrecking estimates).
 * - weight = max(0.2, 1 / (serviceSamples + 2)) (fast warm-up, then EWMA).
 * - avg = avg * (1 - weight) + sample * weight.
 * - serviceSamples += 1.
 */
async function updateServiceAvgEWMA(serviceId, sample) {
  if (typeof sample !== 'number' || sample < 10) {
    return;
  }

  await Service.updateOne(
    { _id: serviceId },
    [
      {
        $set: {
          avgServiceTimeSec: {
            $let: {
              vars: {
                currentAvg: { $ifNull: ['$avgServiceTimeSec', 300] },
                currentSamples: { $ifNull: ['$serviceSamples', 0] },
              },
              in: {
                $let: {
                  vars: {
                    cappedSample: {
                      $min: [
                        sample,
                        { $multiply: [3, '$$currentAvg'] },
                      ],
                    },
                    weight: {
                      $max: [
                        0.2,
                        { $divide: [1, { $add: ['$$currentSamples', 2] }] },
                      ],
                    },
                  },
                  in: {
                    $add: [
                      {
                        $multiply: [
                          '$$currentAvg',
                          { $subtract: [1, '$$weight'] },
                        ],
                      },
                      {
                        $multiply: ['$$cappedSample', '$$weight'],
                      },
                    ],
                  },
                },
              },
            },
          },
          serviceSamples: {
            $add: [{ $ifNull: ['$serviceSamples', 0] }, 1],
          },
        },
      },
    ]
  );
}

/**
 * Complete a serving token: serving -> completed
 */
async function completeToken({ tokenId, counterId }) {
  const completedAt = new Date();
  const token = await transitionToken({
    tokenId,
    expectedStatuses: ['serving'],
    nextStatus: 'completed',
    counterId,
    updateFields: { completedAt },
  });

  // Track service-time sample if servingAt was recorded
  if (token && token.servingAt) {
    const sample = Math.round(
      (new Date(token.completedAt || completedAt).getTime() - new Date(token.servingAt).getTime()) / 1000
    );
    // Ignore samples under 10s (no change at all)
    if (sample >= 10) {
      await updateServiceAvgEWMA(token.serviceId, sample);
    }
  }

  return token;
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

/**
 * Mark a called token as no_show if its grace period has elapsed.
 * ONE atomic findOneAndUpdate through the state machine:
 * filter: { _id: tokenId, status: 'called', calledAt: { $lte: new Date(now - graceMs + 1000) } }
 * sets no_show, clears the counter's convenience pointer, publishes tokenChanged.
 * A non-match is a no-op returning { changed: false, token: null }.
 * That filter is what makes duplicate or early jobs harmless.
 */
async function markNoShow({
  tokenId,
  graceMs = (env.NO_SHOW_GRACE_SECONDS || 180) * 1000,
  now = Date.now(),
}) {
  assertTransition('called', 'no_show');

  const cutoff = new Date(now - graceMs + 1000);
  const filter = {
    _id: tokenId,
    status: 'called',
    calledAt: { $lte: cutoff },
  };

  const update = {
    status: 'no_show',
    isActive: false,
    isHoldingCounter: false,
  };

  const token = await Token.findOneAndUpdate(filter, { $set: update }, { new: true });

  if (!token) {
    return { changed: false, token: null };
  }

  // Clear counter currentTokenId convenience pointer
  if (token.counterId) {
    await Counter.updateOne(
      { _id: token.counterId, currentTokenId: token._id },
      { currentTokenId: null }
    );
  }

  // Publish domain event ONLY after DB write succeeds
  publishTokenChanged({
    serviceId: token.serviceId,
    queueDate: token.queueDate,
    tokenId: token._id,
    userId: token.userId,
    status: token.status,
  });

  return { changed: true, token };
}

/**
 * Read-only queue snapshot for a service on a given queueDate.
 * 1. Reads waiting tokens in call order (priority desc, number asc).
 * 2. Reads called/serving tokens with populated counter details.
 * 3. Reads Service document to get avgServiceTimeSec.
 * 4. Reads active counters and matches them with their held tokens (including servingAt).
 * 5. Calls pure computeEtas once for the entire waiting list.
 */
async function getQueueSnapshot(serviceId, queueDate = getQueueDate()) {
  const [waitingTokens, activeTokens, service, activeCounters] = await Promise.all([
    Token.find({
      serviceId,
      queueDate,
      status: 'waiting',
    }).sort({ priority: -1, number: 1 }),
    Token.find({
      serviceId,
      queueDate,
      status: { $in: ['called', 'serving'] },
    }).populate('counterId', 'name'),
    Service.findById(serviceId),
    Counter.find({ serviceId, status: 'active' }),
  ]);

  const nowServing = activeTokens.map((t) => ({
    counterId: t.counterId ? (t.counterId._id || t.counterId).toString() : null,
    counterName: t.counterId ? t.counterId.name : null,
    tokenNumber: t.number,
    status: t.status,
  }));

  // Map each active counter to the token it currently holds (with servingAt/calledAt)
  const tokenByCounterId = new Map();
  for (const t of activeTokens) {
    if (t.counterId) {
      const cId = (t.counterId._id || t.counterId).toString();
      tokenByCounterId.set(cId, t);
    }
  }

  const simulatedCounters = activeCounters.map((c) => {
    const heldToken = tokenByCounterId.get(c._id.toString());
    return {
      id: c._id.toString(),
      status: c.status,
      currentToken: heldToken
        ? {
            status: heldToken.status,
            servingAt: heldToken.servingAt,
            calledAt: heldToken.calledAt,
          }
        : null,
    };
  });

  const avgServiceSec = (service && service.avgServiceTimeSec) || 300;
  const etas = computeEtas({
    now: new Date(),
    waiting: waitingTokens,
    counters: simulatedCounters,
    avgServiceSec,
  });

  // Attach etaSeconds to each waiting token
  const waitingTokensWithEta = waitingTokens.map((t, idx) => {
    const doc = t.toObject ? t.toObject() : { ...t };
    doc.etaSeconds = etas[idx] !== undefined ? etas[idx] : null;
    return doc;
  });

  return {
    serviceId: serviceId.toString(),
    queueDate,
    waitingCount: waitingTokens.length,
    avgServiceSec,
    nowServing,
    waitingTokens: waitingTokensWithEta,
    activeTokens,
    etas,
  };
}

module.exports = {
  joinQueue,
  getTokenStatus,
  callNext,
  startServing,
  completeToken,
  skipToken,
  cancelToken,
  markNoShow,
  transitionToken,
  getQueueSnapshot,
  updateServiceAvgEWMA,
};
