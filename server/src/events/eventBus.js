const EventEmitter = require('events');

/**
 * Shared in-process domain event bus.
 * Decouples core business logic from transport layers (Socket.io, webhooks, analytics).
 * queueService publishes events here; it NEVER imports Socket.io.
 */
class DomainEventBus extends EventEmitter {}

const eventBus = new DomainEventBus();

/**
 * Publishes 'tokenChanged' domain event after a successful database write.
 * Safely wraps listener execution so throwing listeners never abort or fail the calling request.
 *
 * @param {object} event
 * @param {string} event.serviceId
 * @param {string} event.queueDate
 * @param {string} event.tokenId
 * @param {string} event.userId
 * @param {string} event.status
 */
function publishTokenChanged({ serviceId, queueDate, tokenId, userId, status }) {
  try {
    eventBus.emit('tokenChanged', {
      serviceId: serviceId.toString(),
      queueDate,
      tokenId: tokenId.toString(),
      userId: userId.toString(),
      status,
    });
  } catch (err) {
    console.error('Error publishing tokenChanged domain event:', err);
  }
}

module.exports = {
  eventBus,
  publishTokenChanged,
};
