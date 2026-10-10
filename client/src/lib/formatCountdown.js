/**
 * Formats a duration in seconds into a countdown clock string "M:SS".
 *
 * Examples:
 * - 180 -> "3:00"
 * - 125 -> "2:05"
 * - 59  -> "0:59"
 * - 5   -> "0:05"
 * - 0 / negative / null -> "0:00"
 */
export function formatCountdown(seconds) {
  if (seconds == null || isNaN(seconds) || seconds <= 0) {
    return '0:00';
  }

  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  const paddedSeconds = remainingSeconds < 10 ? `0${remainingSeconds}` : `${remainingSeconds}`;
  return `${minutes}:${paddedSeconds}`;
}
