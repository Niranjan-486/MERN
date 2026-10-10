const { eventBus } = require('../events/eventBus');
const { addTimerJob, removeTimerJob, addNotifyJob } = require('./queues');
const { scheduleNearPlanner } = require('./planner');
const env = require('../config/env');

let isListening = false;

async function onTokenChanged({ serviceId, queueDate, tokenId, status }) {
  try {
    const tid = tokenId.toString();
    const sid = serviceId.toString();
    const graceMs = (env.NO_SHOW_GRACE_SECONDS || 180) * 1000;

    if (status === 'called') {
      // 1. Schedule automatic no-show timer delayed by the grace period
      await addTimerJob(
        `noshow-${tid}`,
        { tokenId: tid, graceMs },
        { delay: graceMs }
      );

      // 2. Schedule "called" notification
      await addNotifyJob(`notify-${tid}-called`, {
        tokenId: tid,
        kind: 'called',
      });
    } else if (
      status === 'serving' ||
      status === 'skipped' ||
      status === 'cancelled'
    ) {
      // Best-effort cancellation of the pending no-show timer
      await removeTimerJob(`noshow-${tid}`);
    } else if (status === 'no_show') {
      // Schedule "no_show" notification
      await addNotifyJob(`notify-${tid}-no_show`, {
        tokenId: tid,
        kind: 'no_show',
      });
    }

    // Schedule near-planner for every event
    scheduleNearPlanner(sid, queueDate);
  } catch (err) {
    // Listener must never throw or disrupt application flow
    console.warn('[JOBS_LISTENER] Error handling tokenChanged event:', err.message);
  }
}

function startListener() {
  if (isListening) return;
  eventBus.on('tokenChanged', onTokenChanged);
  isListening = true;
}

function stopListener() {
  if (!isListening) return;
  eventBus.removeListener('tokenChanged', onTokenChanged);
  isListening = false;
}

module.exports = {
  startListener,
  stopListener,
  onTokenChanged,
};
