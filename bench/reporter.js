const fs = require('fs');
const path = require('path');

/**
 * Formats results into Markdown, JSON and spec console outputs.
 */
class BenchmarkReporter {
  constructor(reportData) {
    this.data = reportData;
    this.reportsDir = path.resolve(__dirname, 'reports');
  }

  generateMarkdown() {
    const { envInfo, summary, scenarios, timestamp } = this.data;

    let md = `# SmartQueue Benchmark Report\n\n`;
    md += `**Date:** ${new Date(timestamp).toUTCString()}  \n`;
    md += `**Overall Status:** ${summary.passed ? '✅ PASSED' : '❌ FAILED'}  \n`;
    md += `**Total Scenarios:** ${summary.total} | **Passed:** ${summary.passedCount} | **Failed:** ${summary.failedCount}\n\n`;

    md += `## 1. System Environment\n\n`;
    md += `| Parameter | Value |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **CPU Model** | ${envInfo.cpuModel} |\n`;
    md += `| **CPU Cores** | ${envInfo.cpuCores} cores |\n`;
    md += `| **Total RAM** | ${envInfo.totalRamGb} GB |\n`;
    md += `| **Operating System** | ${envInfo.os} |\n`;
    md += `| **Node.js Version** | ${envInfo.nodeVersion} |\n`;
    md += `| **Git Commit** | \`${envInfo.gitCommit}\` |\n`;
    md += `| **MongoDB Version** | ${envInfo.mongoVersion} |\n`;
    md += `| **Redis Version** | ${envInfo.redisVersion} |\n`;
    md += `| **Target URL** | ${envInfo.apiUrl} |\n\n`;

    md += `## 2. Benchmark Scenarios Summary\n\n`;
    md += `| Scenario | N | Throughput / Rate | Latency p50 | Latency p95 | Latency p99 | Peak RSS | ELD p99 | Status |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const sc of scenarios) {
      const p50 = sc.percentiles?.p50 ?? sc.callNextToCalledPercentiles?.p50 ?? '-';
      const p95 = sc.percentiles?.p95 ?? sc.callNextToCalledPercentiles?.p95 ?? '-';
      const p99 = sc.percentiles?.p99 ?? sc.callNextToCalledPercentiles?.p99 ?? '-';
      const throughput = sc.throughputReqPerSec
        ? `${sc.throughputReqPerSec} req/s`
        : sc.queueDrainRatePerMin
        ? `${sc.queueDrainRatePerMin} /min`
        : `${Math.round((sc.totalCount / (sc.durationMs / 1000)) * 10) / 10} /s`;
      const peakRss = sc.metrics?.rssMB?.max ? `${sc.metrics.rssMB.max} MB` : '-';
      const eld99 = sc.metrics?.eventLoopDelayP99?.max ? `${sc.metrics.eventLoopDelayP99.max} ms` : '-';
      const statusIcon = sc.passed ? '✅ Pass' : '❌ Fail';

      md += `| **${sc.scenario}** | ${sc.patientCount || sc.totalCount} | ${throughput} | ${p50} ms | ${p95} ms | ${p99} ms | ${peakRss} | ${eld99} | ${statusIcon} |\n`;
    }
    md += `\n`;

    md += `## 3. Scenario Details\n\n`;
    for (const sc of scenarios) {
      md += `### Scenario: \`${sc.scenario}\` (N=${sc.patientCount || sc.totalCount})\n\n`;
      md += `- **Outcome:** ${sc.passed ? 'Passed' : 'Failed'}\n`;
      if (sc.failures && sc.failures.length > 0) {
        md += `- **Failures:**\n`;
        for (const f of sc.failures) {
          md += `  - ⚠️ ${f}\n`;
        }
      }
      md += `- **Duration:** ${sc.durationMs} ms\n`;
      if (sc.scenario === 'burst') {
        md += `- **Contiguity:** ${sc.isContiguous ? 'Strictly Contiguous (No gaps)' : 'Failed contiguity'}\n`;
        md += `- **Duplicate Tokens:** ${sc.duplicateCount || 0}\n`;
        md += `- **Convergence Time:** ${sc.convergenceTimeMs} ms\n`;
        md += `- **Coalescing Ratio:** ${Math.round((sc.coalescing?.ratio || 0) * 100)}% (avg ${sc.coalescing?.avgQueueUpdates} updates per socket vs ${sc.patientCount} joins)\n`;
      } else if (sc.scenario === 'flow') {
        md += `- **Tokens Completed:** ${sc.completedCount} / ${sc.totalCount}\n`;
        md += `- **Stuck Tokens:** ${sc.stuckCount} (Invariant required: 0)\n`;
        md += `- **Call-Next to Called Latency (p50/p95/p99):** ${sc.callNextToCalledPercentiles?.p50}ms / ${sc.callNextToCalledPercentiles?.p95}ms / ${sc.callNextToCalledPercentiles?.p99}ms\n`;
        md += `- **Notification Latency (p50/p95/p99):** ${sc.notificationPercentiles?.p50}ms / ${sc.notificationPercentiles?.p95}ms / ${sc.notificationPercentiles?.p99}ms\n`;
      } else if (sc.scenario === 'reconnect') {
        md += `- **Reconnected:** ${sc.reconnectedCount} / ${sc.totalCount}\n`;
        md += `- **Stranded:** ${sc.strandedCount || 0}\n`;
        md += `- **Recovery Latency (p50/p95/p99):** ${sc.percentiles?.p50}ms / ${sc.percentiles?.p95}ms / ${sc.percentiles?.p99}ms\n`;
      }
      md += `\n`;
    }

    return md;
  }

  saveReports() {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }

    const fileTimestamp = new Date(this.data.timestamp).toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(this.reportsDir, `${fileTimestamp}.json`);
    const mdPath = path.join(this.reportsDir, `${fileTimestamp}.md`);
    const latestJsonPath = path.join(this.reportsDir, 'latest.json');

    const mdContent = this.generateMarkdown();
    const jsonContent = JSON.stringify(this.data, null, 2);

    fs.writeFileSync(jsonPath, jsonContent, 'utf8');
    fs.writeFileSync(mdPath, mdContent, 'utf8');
    fs.writeFileSync(latestJsonPath, jsonContent, 'utf8');

    return {
      jsonPath,
      mdPath,
      latestJsonPath,
    };
  }

  printSpec() {
    const { envInfo, summary, scenarios } = this.data;
    console.log('\n' + '='.repeat(70));
    console.log('              SMARTQUEUE BENCHMARK REPORT');
    console.log('='.repeat(70));
    console.log(`Target:      ${envInfo.apiUrl}`);
    console.log(`System:      ${envInfo.cpuModel} (${envInfo.cpuCores} cores, ${envInfo.totalRamGb} GB RAM)`);
    console.log(`OS:          ${envInfo.os}`);
    console.log(`Node / Git:  ${envInfo.nodeVersion} / ${envInfo.gitCommit}`);
    console.log(`Mongo / Rd:  ${envInfo.mongoVersion} / ${envInfo.redisVersion}`);
    console.log('-'.repeat(70));

    for (const sc of scenarios) {
      const status = sc.passed ? '[PASS]' : '[FAIL]';
      console.log(`\nScenario: ${sc.scenario.toUpperCase()} (N=${sc.patientCount || sc.totalCount}) ${status}`);
      console.log(`  Duration:    ${sc.durationMs}ms`);
      if (sc.throughputReqPerSec) {
        console.log(`  Throughput:  ${sc.throughputReqPerSec} req/s`);
      }
      if (sc.queueDrainRatePerMin) {
        console.log(`  Drain Rate:  ${sc.queueDrainRatePerMin} patients/min`);
      }
      const p = sc.percentiles || sc.callNextToCalledPercentiles;
      if (p) {
        console.log(`  Latencies:   p50=${p.p50}ms, p90=${p.p90}ms, p95=${p.p95}ms, p99=${p.p99}ms (min=${p.min}ms, max=${p.max}ms)`);
      }
      if (sc.scenario === 'burst') {
        console.log(`  Contiguity:  ${sc.isContiguous ? 'Contiguous' : 'NON-CONTIGUOUS'} | Duplicates: ${sc.duplicateCount || 0}`);
        console.log(`  Convergence: ${sc.convergenceTimeMs}ms`);
        console.log(`  Coalescing:  avg ${sc.coalescing?.avgQueueUpdates} queue:updated/socket (ratio: ${Math.round((sc.coalescing?.ratio || 0) * 100)}%)`);
      } else if (sc.scenario === 'flow') {
        console.log(`  Completed:   ${sc.completedCount}/${sc.totalCount} | Stuck: ${sc.stuckCount}`);
      } else if (sc.scenario === 'reconnect') {
        console.log(`  Reconnected: ${sc.reconnectedCount}/${sc.totalCount} | Stranded: ${sc.strandedCount || 0}`);
      }
      if (sc.metrics) {
        console.log(`  Resources:   RSS peak=${sc.metrics.rssMB?.max || '-'}MB, ELD p99=${sc.metrics.eventLoopDelayP99?.max || '-'}ms, Sockets peak=${sc.metrics.connectedSocketsPeak || '-'}`);
      }
      if (sc.failures && sc.failures.length > 0) {
        for (const f of sc.failures) {
          console.log(`  ⚠️  Failure: ${f}`);
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`OVERALL: ${summary.passed ? 'ALL TESTS PASSED' : 'FAILURES DETECTED'} (${summary.passedCount}/${summary.total} passed)`);
    console.log('='.repeat(70) + '\n');
  }
}

module.exports = { BenchmarkReporter };
