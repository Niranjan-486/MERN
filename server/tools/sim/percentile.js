/**
 * Calculates summary statistics and percentiles (p50, p90, p95, p99) from an array of numbers.
 * Uses linear interpolation for percentiles.
 */
function calculatePercentiles(values) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values]
    .map(Number)
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const getP = (p) => {
    if (sorted.length === 1) return sorted[0];
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round((sum / sorted.length) * 100) / 100,
    p50: Math.round(getP(50) * 100) / 100,
    p90: Math.round(getP(90) * 100) / 100,
    p95: Math.round(getP(95) * 100) / 100,
    p99: Math.round(getP(99) * 100) / 100,
  };
}

module.exports = { calculatePercentiles };
