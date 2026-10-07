const { Server } = require('socket.io');
const env = require('../config/env');
const { verifyToken } = require('../middleware/auth');
const { Service, Token } = require('../models');
const { getQueueDate } = require('../utils/queueDate');
const { eventBus } = require('../events/eventBus');
const queueService = require('../services/queueService');

/**
 * Creates and attaches Socket.io to the HTTP server.
 * Returns the io instance.
 *
 * Architecture:
 * - Server decides all rooms; clients never choose or join rooms directly.
 * - Authenticates handshake via JWT.
 * - Subscribes to in-process domain events (tokenChanged).
 * - Implements single-flight batching per (serviceId, queueDate) to coalesce burst updates.
 */
function createRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // 1. Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    try {
      const decoded = verifyToken(token);
      socket.user = {
        id: decoded.sub,
        role: decoded.role,
        organizationId: decoded.organizationId || null,
      };
      next();
    } catch (_err) {
      next(new Error('Invalid or expired authentication token'));
    }
  });

  // 2. Room Assignment on Connection
  io.on('connection', async (socket) => {
    try {
      // FIRST: Join user personal room (user:{userId})
      socket.join(`user:${socket.user.id}`);

      // THEN: Join relevant service rooms
      const queueDate = getQueueDate();

      if (socket.user.role === 'patient') {
        // Patients join service rooms for their active tokens today
        const activeTokens = await Token.find({
          userId: socket.user.id,
          queueDate,
          isActive: true,
        }).select('serviceId');

        for (const t of activeTokens) {
          socket.join(`service:${t.serviceId.toString()}`);
        }
      } else if (socket.user.organizationId) {
        // Staff/Admin join all service rooms belonging to their organization
        const orgServices = await Service.find({
          organizationId: socket.user.organizationId,
        }).select('_id');

        for (const s of orgServices) {
          socket.join(`service:${s._id.toString()}`);
        }
      }
    } catch (err) {
      console.error('Error assigning rooms on socket connection:', err);
    }
  });

  // 3. Single-Flight Coalescing Engine
  // Map key: `${serviceId}:${queueDate}` -> State object
  const flightMap = new Map();

  function scheduleRun(key) {
    const entry = flightMap.get(key);
    if (!entry) return;

    if (entry.isRunning) {
      // Mark for another pass once the current in-flight pass finishes
      entry.rerunScheduled = true;
      return;
    }

    entry.isRunning = true;
    executeRun(key);
  }

  async function executeRun(key) {
    const entry = flightMap.get(key);
    if (!entry) return;

    try {
      do {
        entry.rerunScheduled = false;

        // Take snapshot of tokens modified in this batch and reset pending set
        const tokensToProcess = Array.from(entry.pendingTokenIds);
        entry.pendingTokenIds.clear();

        try {
          // A. Read fresh queue state from DB
          const snapshot = await queueService.getQueueSnapshot(
            entry.serviceId,
            entry.queueDate
          );

          // B. Fetch any tokens that transitioned to terminal states (completed/cancelled)
          // so their final status is broadcast once to their user room
          const extraTokens =
            tokensToProcess.length > 0
              ? await Token.find({ _id: { $in: tokensToProcess } }).populate(
                  'counterId',
                  'name'
                )
              : [];

          const emittedTokenIds = new Set();

          // C. Emit token:updated to each waiting patient
          for (let i = 0; i < snapshot.waitingTokens.length; i++) {
            const t = snapshot.waitingTokens[i];
            const tid = t._id.toString();
            emittedTokenIds.add(tid);

            const payload = {
              tokenId: tid,
              serviceId: t.serviceId.toString(),
              number: t.number,
              status: t.status,
              priority: t.priority,
              peopleAhead: i, // Index in sorted waiting array is exact count of people ahead
              counterName: null,
            };
            io.to(`user:${t.userId.toString()}`).emit('token:updated', payload);
          }

          // D. Emit token:updated to each active (called/serving) patient
          for (const t of snapshot.activeTokens) {
            const tid = t._id.toString();
            emittedTokenIds.add(tid);

            const payload = {
              tokenId: tid,
              serviceId: t.serviceId.toString(),
              number: t.number,
              status: t.status,
              priority: t.priority,
              peopleAhead: null,
              counterName: (t.counterId && t.counterId.name) || null,
            };
            io.to(`user:${t.userId.toString()}`).emit('token:updated', payload);
          }

          // E. Emit terminal status (completed/cancelled) for pending tokens
          for (const t of extraTokens) {
            const tid = t._id.toString();
            if (!emittedTokenIds.has(tid)) {
              emittedTokenIds.add(tid);
              const payload = {
                tokenId: tid,
                serviceId: t.serviceId.toString(),
                number: t.number,
                status: t.status,
                priority: t.priority,
                peopleAhead: null,
                counterName: (t.counterId && t.counterId.name) || null,
              };
              io.to(`user:${t.userId.toString()}`).emit('token:updated', payload);
            }
          }

          // F. Emit queue:updated to the service room
          const queuePayload = {
            serviceId: entry.serviceId,
            queueDate: entry.queueDate,
            waitingCount: snapshot.waitingCount,
            nowServing: snapshot.nowServing,
          };
          io.to(`service:${entry.serviceId}`).emit('queue:updated', queuePayload);
        } catch (err) {
          console.error(`Error in realtime execution run for ${key}:`, err);
        }
      } while (entry.rerunScheduled);
    } finally {
      entry.isRunning = false;
      if (entry.pendingTokenIds.size === 0 && !entry.rerunScheduled) {
        flightMap.delete(key);
      }
    }
  }

  // 4. Domain Event Listener
  const onTokenChanged = async ({ serviceId, queueDate, tokenId, userId, status }) => {
    try {
      // When a patient joins a queue (waiting), add all of that user's sockets to the service room
      if (status === 'waiting') {
        await io.in(`user:${userId}`).socketsJoin(`service:${serviceId}`);
      }

      const key = `${serviceId}:${queueDate}`;
      let entry = flightMap.get(key);
      if (!entry) {
        entry = {
          serviceId,
          queueDate,
          pendingTokenIds: new Set(),
          isRunning: false,
          rerunScheduled: false,
        };
        flightMap.set(key, entry);
      }

      entry.pendingTokenIds.add(tokenId.toString());
      scheduleRun(key);
    } catch (err) {
      console.error('Error handling tokenChanged domain event:', err);
    }
  };

  eventBus.on('tokenChanged', onTokenChanged);

  // Expose clean teardown for test suites
  io.cleanup = () => {
    eventBus.removeListener('tokenChanged', onTokenChanged);
  };

  return io;
}

module.exports = {
  createRealtime,
};
