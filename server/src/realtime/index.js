const { Server } = require('socket.io');
const env = require('../config/env');
const { verifyToken } = require('../middleware/auth');
const { Service, Token } = require('../models');
const { getQueueDate } = require('../utils/queueDate');
const { eventBus } = require('../events/eventBus');
const { createSingleFlightByKey } = require('../utils/singleFlightByKey');
const queueService = require('../services/queueService');

let activeIo = null;

/**
 * Returns the currently active Socket.io instance, if any.
 */
function getIo() {
  return activeIo;
}

/**
 * Emits an in-app notification event to the targeted user's room.
 * Delivers { id, kind, title, body, tokenId, createdAt }.
 */
function emitNotificationToUser(userId, notification) {
  if (!activeIo) return;
  const payload = {
    id: (notification._id || notification.id).toString(),
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    tokenId: (
      notification.tokenId && (notification.tokenId._id || notification.tokenId)
    ).toString(),
    createdAt: notification.createdAt || new Date(),
  };
  activeIo.to(`user:${userId.toString()}`).emit('notification:new', payload);
}

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
      origin: env.CLIENT_ORIGINS,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  activeIo = io;

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
  const singleFlight = createSingleFlightByKey(
    async (key, entry) => {
      const [serviceId, queueDate] = key.split(':');
      const tokensToProcess = Array.from(entry.items);
      entry.items.clear();

      // A. Read fresh queue state from DB
      const snapshot = await queueService.getQueueSnapshot(serviceId, queueDate);

      // B. Fetch terminal status tokens (completed/cancelled/skipped/no_show)
      const extraTokens =
        tokensToProcess.length > 0
          ? await Token.find({ _id: { $in: tokensToProcess } }).populate('counterId', 'name')
          : [];

      const emittedTokenIds = new Set();
      const graceMs = (env.NO_SHOW_GRACE_SECONDS || 180) * 1000;
      const now = Date.now();

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
          peopleAhead: i,
          counterName: null,
          etaSeconds: t.etaSeconds !== undefined ? t.etaSeconds : null,
          noShowInSec: null,
        };
        io.to(`user:${t.userId.toString()}`).emit('token:updated', payload);
      }

      // D. Emit token:updated to each active (called/serving) patient
      for (const t of snapshot.activeTokens) {
        const tid = t._id.toString();
        emittedTokenIds.add(tid);

        const isCalled = t.status === 'called';
        const noShowInSec =
          isCalled && t.calledAt
            ? Math.max(0, Math.round((new Date(t.calledAt).getTime() + graceMs - now) / 1000))
            : null;

        const payload = {
          tokenId: tid,
          serviceId: t.serviceId.toString(),
          number: t.number,
          status: t.status,
          priority: t.priority,
          peopleAhead: null,
          counterName: (t.counterId && t.counterId.name) || null,
          etaSeconds: null,
          noShowInSec,
        };
        io.to(`user:${t.userId.toString()}`).emit('token:updated', payload);
      }

      // E. Emit terminal status for pending tokens
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
            etaSeconds: null,
            noShowInSec: null,
          };
          io.to(`user:${t.userId.toString()}`).emit('token:updated', payload);
        }
      }

      // F. Emit queue:updated to the service room
      const queuePayload = {
        serviceId,
        queueDate,
        waitingCount: snapshot.waitingCount,
        nowServing: snapshot.nowServing,
      };
      io.to(`service:${serviceId}`).emit('queue:updated', queuePayload);
    },
    {
      onError: (err, key) => {
        console.error(`Error in realtime execution run for ${key}:`, err.message || err);
      },
    }
  );

  // 4. Domain Event Listener
  const onTokenChanged = async ({ serviceId, queueDate, tokenId, userId, status }) => {
    try {
      if (status === 'waiting') {
        await io.in(`user:${userId}`).socketsJoin(`service:${serviceId}`);
      }

      const key = `${serviceId}:${queueDate}`;
      singleFlight.schedule(key, tokenId.toString());
    } catch (err) {
      console.error('Error handling tokenChanged domain event:', err);
    }
  };

  eventBus.on('tokenChanged', onTokenChanged);

  // Expose clean teardown for test suites
  io.cleanup = () => {
    eventBus.removeListener('tokenChanged', onTokenChanged);
    singleFlight.clear();
    if (activeIo === io) {
      activeIo = null;
    }
  };

  return io;
}

module.exports = {
  createRealtime,
  getIo,
  emitNotificationToUser,
};
