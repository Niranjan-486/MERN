/**
 * Pure wait-time ETA formatter.
 *
 * Rules:
 * - null / undefined / < 0 / NaN -> null (caller hides the display)
 * - under 60 s -> "less than a minute"
 * - otherwise nearest minute (halves round up, e.g. 89s -> 1 min, 90s -> 2 min)
 * - 60+ minutes in "1 h 30 min" style (e.g. 3600s -> "1 h", 5400s -> "1 h 30 min")
 *
 * @param {number|null} seconds
 * @returns {string|null}
 */
export function formatEta(seconds) {
  if (
    seconds === null ||
    seconds === undefined ||
    typeof seconds !== 'number' ||
    isNaN(seconds) ||
    seconds < 0
  ) {
    return null;
  }

  if (seconds < 60) {
    return 'less than a minute';
  }

  // Round to nearest minute (halves round up via Math.round)
  const totalMinutes = Math.round(seconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${remainingMinutes} min`;
}
