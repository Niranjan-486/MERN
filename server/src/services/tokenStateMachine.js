/**
 * Token State Machine — pure module, no I/O.
 *
 * States:
 *   waiting  -> called | cancelled
 *   called   -> serving | skipped | no_show | cancelled
 *   serving  -> completed
 *   Terminal: completed, skipped, no_show, cancelled
 */

// All possible statuses
const STATUSES = Object.freeze({
  WAITING: 'waiting',
  CALLED: 'called',
  SERVING: 'serving',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  NO_SHOW: 'no_show',
  CANCELLED: 'cancelled',
});

// Statuses where the token is still "live" in the queue
const ACTIVE_STATUSES = Object.freeze(['waiting', 'called', 'serving']);

// Terminal statuses — no further transitions possible
const TERMINAL_STATUSES = Object.freeze(['completed', 'skipped', 'no_show', 'cancelled']);

// Allowed transitions: key = current status, value = array of valid next statuses
const TRANSITIONS = Object.freeze({
  waiting: Object.freeze(['called', 'cancelled']),
  called: Object.freeze(['serving', 'skipped', 'no_show', 'cancelled']),
  serving: Object.freeze(['completed']),
  // Terminal states have no outgoing transitions
  completed: Object.freeze([]),
  skipped: Object.freeze([]),
  no_show: Object.freeze([]),
  cancelled: Object.freeze([]),
});

/**
 * Check whether transitioning from `from` to `to` is allowed.
 * @param {string} from - current status
 * @param {string} to   - desired next status
 * @returns {boolean}
 */
function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Assert that transitioning from `from` to `to` is legal.
 * Throws a descriptive error if not.
 * @param {string} from - current status
 * @param {string} to   - desired next status
 */
function assertTransition(from, to) {
  if (!TRANSITIONS[from]) {
    throw new Error(`Unknown token status: "${from}"`);
  }
  if (!Object.values(STATUSES).includes(to)) {
    throw new Error(`Unknown token status: "${to}"`);
  }
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    const hint = allowed.length
      ? `Allowed transitions from "${from}": ${allowed.join(', ')}`
      : `"${from}" is a terminal status — no transitions allowed`;
    throw new Error(`Illegal transition: "${from}" -> "${to}". ${hint}`);
  }
}

/**
 * Returns true if the given status is active (token is live in the queue).
 * Used by the Token model to maintain the isActive flag.
 * @param {string} status
 * @returns {boolean}
 */
function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status);
}

module.exports = {
  STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  canTransition,
  assertTransition,
  isActiveStatus,
};
