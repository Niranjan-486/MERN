const env = require('../config/env');

/**
 * Returns YYYY-MM-DD for the given date in the specified timeZone.
 * Uses built-in Intl.DateTimeFormat with 'en-CA' locale which outputs YYYY-MM-DD.
 *
 * @param {Date|string|number} [date=new Date()]
 * @param {string} [timeZone=env.TIMEZONE]
 * @returns {string} YYYY-MM-DD
 */
function getQueueDate(date = new Date(), timeZone = env.TIMEZONE) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

module.exports = { getQueueDate };
