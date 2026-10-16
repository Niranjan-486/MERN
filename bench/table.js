const fs = require('fs');
const path = require('path');

function generateMarkdownTables(report) {
  const { envInfo, scenarios } = report;

  let out = `### Benchmark Environment\n\n`;
  out += `| Parameter | Host Specification |\n`;
  out += `| :--- | :--- |\n`;
  out += `| **CPU** | ${envInfo.cpuModel} (${envInfo.cpuCores} cores) |\n`;
  out += `| **RAM** | ${envInfo.totalRamGb} GB |\n`;
  out += `| **OS** | ${envInfo.os} |\n`;
  out += `| **Runtime** | Node.js ${envInfo.nodeVersion} |\n`;
  out += `| **Commit** | \`${envInfo.gitCommit}\` |\n`;
  out += `| **Databases** | MongoDB ${envInfo.mongoVersion}, Redis ${envInfo.redisVersion} |\n\n`;

  out += `### Measured Results\n\n`;
  out += `| Scenario | N | Throughput / Drain Rate | Latency p50 | Latency p95 | Latency p99 | Peak RSS | Event Loop Delay p99 | Status |\n`;
  out += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

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
    const statusIcon = sc.passed ? '✅ PASS' : '❌ FAIL';

    out += `| **${sc.scenario}** | ${sc.patientCount || sc.totalCount} | ${throughput} | ${p50} ms | ${p95} ms | ${p99} ms | ${peakRss} | ${eld99} | ${statusIcon} |\n`;
  }

  return out;
}

function run() {
  const latestPath = path.resolve(__dirname, 'reports/latest.json');
  if (!fs.existsSync(latestPath)) {
    console.error('No benchmark reports found at bench/reports/latest.json. Run "npm run bench" first.');
    process.exit(1);
  }

  try {
    const report = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    const markdown = generateMarkdownTables(report);
    console.log(markdown);
  } catch (err) {
    console.error(`Failed to generate benchmark table: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { generateMarkdownTables };
