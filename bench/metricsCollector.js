/**
 * Background metrics collector querying GET /internal/metrics every 1s.
 */
class MetricsCollector {
  constructor({ apiUrl, simulatorKey, intervalMs = 1000 }) {
    this.apiUrl = apiUrl;
    this.simulatorKey = simulatorKey;
    this.intervalMs = intervalMs;
    this.samples = [];
    this.timer = null;
    this.isPolling = false;
  }

  start() {
    this.samples = [];
    this.isPolling = true;

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const res = await fetch(`${this.apiUrl}/internal/metrics`, {
          headers: {
            'x-simulator-key': this.simulatorKey,
          },
        });
        if (res.ok) {
          const data = await res.json();
          this.samples.push({
            timestamp: Date.now(),
            ...data,
          });
        }
      } catch (_) {
        // Server might be busy or shutting down
      }
    };

    // First sample immediately
    poll();
    this.timer = setInterval(poll, this.intervalMs);
  }

  stop() {
    this.isPolling = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    return this.summarize();
  }

  summarize() {
    if (this.samples.length === 0) {
      return {
        sampleCount: 0,
        rssMB: { min: 0, max: 0, avg: 0 },
        heapUsedMB: { min: 0, max: 0, avg: 0 },
        cpuUserMs: { min: 0, max: 0, avg: 0 },
        cpuSystemMs: { min: 0, max: 0, avg: 0 },
        eventLoopDelayP99: { min: 0, max: 0, avg: 0 },
        connectedSocketsPeak: 0,
      };
    }

    const calc = (extractor) => {
      const vals = this.samples.map(extractor).filter((v) => typeof v === 'number' && !isNaN(v));
      if (vals.length === 0) return { min: 0, max: 0, avg: 0 };
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const sum = vals.reduce((a, b) => a + b, 0);
      const avg = Math.round((sum / vals.length) * 100) / 100;
      return { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100, avg };
    };

    const socketCounts = this.samples.map((s) => s.connectedSockets || 0);

    return {
      sampleCount: this.samples.length,
      rssMB: calc((s) => s.rssMB),
      heapUsedMB: calc((s) => s.heapUsedMB),
      cpuUserMs: calc((s) => s.cpu?.userMs),
      cpuSystemMs: calc((s) => s.cpu?.systemMs),
      eventLoopDelayP99: calc((s) => s.eventLoopDelay?.p99),
      connectedSocketsPeak: Math.max(...socketCounts, 0),
      lastJobQueue: this.samples[this.samples.length - 1]?.jobQueue || {},
    };
  }
}

module.exports = { MetricsCollector };
