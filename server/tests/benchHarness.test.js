const path = require('path');
const fs = require('fs');

const { evaluateThresholds, THRESHOLDS } = require('../../bench/thresholds');
const { BenchmarkReporter } = require('../../bench/reporter');
const { generateMarkdownTables } = require('../../bench/table');
const { MetricsCollector } = require('../../bench/metricsCollector');

describe('Benchmark Harness Unit Tests', () => {
  const sampleEnvInfo = {
    cpuModel: 'Intel Core i5-1334U',
    cpuCores: 12,
    totalRamGb: 16.0,
    os: 'Windows_NT 10.0 (x64)',
    nodeVersion: 'v20.19.0',
    gitCommit: 'abc1234',
    mongoVersion: '7.0.4',
    redisVersion: '7.4.1',
    apiUrl: 'http://localhost:10050',
  };

  describe('Threshold Evaluation & Correctness Invariants', () => {
    it('passes for a healthy burst scenario', () => {
      const healthyBurst = {
        hasDuplicates: false,
        duplicateCount: 0,
        isContiguous: true,
        errors: 0,
        percentiles: { p50: 120, p90: 250, p95: 350, p99: 450 },
        convergenceTimeMs: 1200,
        queueUpdateRatio: 0.05,
      };

      const result = evaluateThresholds('burst', healthyBurst);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('fails burst evaluation when duplicate token numbers are detected', () => {
      const duplicateBurst = {
        hasDuplicates: true,
        duplicateCount: 2,
        isContiguous: true,
        errors: 0,
        percentiles: { p50: 120, p95: 300 },
        convergenceTimeMs: 1000,
        queueUpdateRatio: 0.05,
      };

      const result = evaluateThresholds('burst', duplicateBurst);
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes('Duplicate token numbers'))).toBe(true);
    });

    it('fails burst evaluation when token numbers are non-contiguous', () => {
      const nonContiguousBurst = {
        hasDuplicates: false,
        isContiguous: false,
        errors: 0,
        percentiles: { p50: 120, p95: 300 },
        convergenceTimeMs: 1000,
        queueUpdateRatio: 0.05,
      };

      const result = evaluateThresholds('burst', nonContiguousBurst);
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes('not strictly contiguous'))).toBe(true);
    });

    it('fails burst evaluation when p95 join latency exceeds threshold', () => {
      const slowBurst = {
        hasDuplicates: false,
        isContiguous: true,
        errors: 0,
        percentiles: { p50: 120, p95: 50000 },
        convergenceTimeMs: 1000,
        queueUpdateRatio: 0.05,
      };

      const result = evaluateThresholds('burst', slowBurst);
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes('Join latency p95'))).toBe(true);
    });

    it('passes for a healthy flow scenario', () => {
      const healthyFlow = {
        stuckCount: 0,
        errors: 0,
        completionRate: 1.0,
        callNextToCalledPercentiles: { p50: 45, p95: 120 },
      };

      const result = evaluateThresholds('flow', healthyFlow);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('fails flow evaluation when stuck tokens remain in the queue', () => {
      const stuckFlow = {
        stuckCount: 3,
        errors: 0,
        completionRate: 0.99,
        callNextToCalledPercentiles: { p50: 45, p95: 120 },
      };

      const result = evaluateThresholds('flow', stuckFlow);
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes('Stuck tokens detected'))).toBe(true);
    });

    it('passes for a healthy reconnect scenario', () => {
      const healthyReconnect = {
        totalCount: 200,
        reconnectedCount: 200,
        strandedCount: 0,
        peopleAheadMismatches: 0,
        durationMs: 3500,
        errors: 0,
      };

      const result = evaluateThresholds('reconnect', healthyReconnect);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('fails reconnect evaluation when sockets remain stranded', () => {
      const strandedReconnect = {
        totalCount: 200,
        reconnectedCount: 195,
        strandedCount: 5,
        peopleAheadMismatches: 0,
        durationMs: 5000,
        errors: 0,
      };

      const result = evaluateThresholds('reconnect', strandedReconnect);
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes('stranded') || f.includes('reconnected'))).toBe(true);
    });
  });

  describe('BenchmarkReporter & Table Generator', () => {
    const fixtureReport = {
      timestamp: 1729000000000,
      envInfo: sampleEnvInfo,
      summary: {
        total: 3,
        passedCount: 3,
        failedCount: 0,
        passed: true,
      },
      scenarios: [
        {
          scenario: 'burst',
          patientCount: 100,
          totalCount: 100,
          successfulCount: 100,
          errors: 0,
          durationMs: 1500,
          throughputReqPerSec: 66.7,
          percentiles: { p50: 15, p90: 30, p95: 45, p99: 60, min: 10, max: 70 },
          hasDuplicates: false,
          isContiguous: true,
          convergenceTimeMs: 120,
          passed: true,
          failures: [],
          metrics: {
            rssMB: { min: 80, max: 95, avg: 88 },
            eventLoopDelayP99: { min: 1, max: 4, avg: 2 },
          },
        },
      ],
    };

    it('generates markdown report containing environment and scenario tables', () => {
      const reporter = new BenchmarkReporter(fixtureReport);
      const markdown = reporter.generateMarkdown();

      expect(markdown).toContain('# SmartQueue Benchmark Report');
      expect(markdown).toContain('1334U');
      expect(markdown).toContain('66.7 req/s');
      expect(markdown).toContain('✅ Pass');
    });

    it('generates summary table ready for README', () => {
      const table = generateMarkdownTables(fixtureReport);

      expect(table).toContain('### Benchmark Environment');
      expect(table).toContain('### Measured Results');
      expect(table).toContain('| **burst** | 100 |');
      expect(table).toContain('✅ PASS');
    });
  });

  describe('MetricsCollector Calculation Logic', () => {
    it('summarizes samples accurately without crashing on empty samples', () => {
      const collector = new MetricsCollector({
        apiUrl: 'http://localhost:10000',
        simulatorKey: 'test-key',
      });

      const emptySummary = collector.summarize();
      expect(emptySummary.sampleCount).toBe(0);
      expect(emptySummary.rssMB.max).toBe(0);

      collector.samples = [
        { rssMB: 100, heapUsedMB: 50, cpu: { userMs: 10, systemMs: 5 }, eventLoopDelay: { p99: 2 }, connectedSockets: 10 },
        { rssMB: 150, heapUsedMB: 70, cpu: { userMs: 20, systemMs: 10 }, eventLoopDelay: { p99: 8 }, connectedSockets: 25 },
      ];

      const summary = collector.summarize();
      expect(summary.sampleCount).toBe(2);
      expect(summary.rssMB.min).toBe(100);
      expect(summary.rssMB.max).toBe(150);
      expect(summary.rssMB.avg).toBe(125);
      expect(summary.connectedSocketsPeak).toBe(25);
      expect(summary.eventLoopDelayP99.max).toBe(8);
    });
  });
});
