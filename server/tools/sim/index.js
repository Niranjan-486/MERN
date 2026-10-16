const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const { runBurst, runDemo } = require('./runner');

function isLocalhost(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

function parseArg(argv, name, defaultValue) {
  const idx = argv.indexOf(name);
  if (idx !== -1 && argv[idx + 1] !== undefined) {
    return argv[idx + 1];
  }
  return defaultValue;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || !['demo', 'burst'].includes(command)) {
    console.log(
      'Usage: npm run sim -- <demo|burst> [options]\n\n' +
      'Commands:\n' +
      '  demo    Simulate realistic arrivals over time with cancellations & staff bot\n' +
      '  burst   Fire simultaneous joins to benchmark latency, contiguity & convergence\n\n' +
      'Options:\n' +
      '  --api <url>              Backend API URL (default: http://localhost:3000)\n' +
      '  --yes                    Required when targeting a non-localhost API\n' +
      '  --patients <N>           Number of patients (default: 40 for demo, 20 for burst)\n' +
      '  --duration <sec>         Demo duration in seconds (default: 90)\n' +
      '  --cancel-rate <float>    Fraction of patients who cancel (default: 0.05)\n' +
      '  --priority-rate <float>  Fraction joined by staff with priority 1/2 (default: 0.1)\n' +
      '  --staff-bot              Enable automated staff counter bot (default: off)\n' +
      '  --service-time <min-max> Service time range in sec for staff bot (default: 10-20)\n' +
      '  --no-show-rate <float>   Fraction of called tokens left for no-show (default: 0.05)\n'
    );
    process.exit(1);
  }

  const defaultPort = process.env.PORT || 3000;
  const apiUrl = parseArg(argv, '--api', `http://localhost:${defaultPort}`).replace(/\/+$/, '');
  const hasYesFlag = argv.includes('--yes');

  console.log(`Target API: ${apiUrl}`);

  if (!isLocalhost(apiUrl) && !hasYesFlag) {
    console.error(
      `\n[ERROR] Target "${apiUrl}" is not localhost.\n` +
      `To run against a remote environment, pass the --yes flag:\n` +
      `  npm run sim -- ${command} --api ${apiUrl} --yes\n`
    );
    process.exit(1);
  }

  const abortController = new AbortController();
  process.on('SIGINT', () => {
    console.log('\n[SIGINT] Shutting down simulation gracefully...');
    abortController.abort();
    setTimeout(() => process.exit(0), 1000);
  });

  try {
    if (command === 'burst') {
      const patientCount = parseInt(parseArg(argv, '--patients', 20), 10);
      console.log(`Starting burst simulation with ${patientCount} patients...`);

      const result = await runBurst({
        apiUrl,
        patientCount,
        onProgress: (msg) => console.log(msg),
      });

      console.log('\n=== Burst Benchmark Results ===');
      console.log(`Service:             ${result.serviceName} (${result.serviceId})`);
      console.log(`Patients:            ${result.patientCount}`);
      console.log(`Token range:         #${result.minTokenNumber} to #${result.maxTokenNumber}`);
      console.log(`Strictly contiguous: ${result.isContiguous ? 'YES (1..N sequence verified)' : 'NO'}`);
      console.log(`Duplicates:          ${result.hasDuplicates ? 'YES (ERROR)' : 'NONE (0 duplicate tokens)'}`);
      console.log('\n--- Join Latency (HTTP) ---');
      console.log(`p50:                 ${result.percentiles.p50} ms`);
      console.log(`p90:                 ${result.percentiles.p90} ms`);
      console.log(`p95:                 ${result.percentiles.p95} ms`);
      console.log(`p99:                 ${result.percentiles.p99} ms`);
      console.log(`Min:                 ${result.percentiles.min} ms`);
      console.log(`Max:                 ${result.percentiles.max} ms`);
      console.log(`Avg:                 ${result.percentiles.avg} ms`);
      console.log('\n--- Realtime Convergence (WebSocket) ---');
      console.log(`Converged:           ${result.convergence.isConverged ? 'YES' : 'NO'}`);
      console.log(`Convergence Time:    ${result.convergence.convergenceTimeMs ?? 'N/A'} ms`);
      console.log('===============================\n');
    } else if (command === 'demo') {
      const patientCount = parseInt(parseArg(argv, '--patients', 40), 10);
      const duration = parseInt(parseArg(argv, '--duration', 90), 10);
      const cancelRate = parseFloat(parseArg(argv, '--cancel-rate', 0.05));
      const priorityRate = parseFloat(parseArg(argv, '--priority-rate', 0.1));
      const staffBot = argv.includes('--staff-bot');
      const serviceTimeRaw = parseArg(argv, '--service-time', '10-20');
      const serviceTimeParts = serviceTimeRaw.split('-').map(Number);
      const serviceTimeRange = [serviceTimeParts[0] || 10, serviceTimeParts[1] || 20];
      const noShowRate = parseFloat(parseArg(argv, '--no-show-rate', 0.05));

      console.log(
        `Starting demo simulation: ${patientCount} patients spread over ${duration}s ` +
        `(cancelRate: ${cancelRate}, priorityRate: ${priorityRate}, staffBot: ${staffBot ? 'ON' : 'OFF'})...`
      );

      const stats = await runDemo({
        apiUrl,
        patientCount,
        duration,
        cancelRate,
        priorityRate,
        staffBot,
        serviceTimeRange,
        noShowRate,
        abortSignal: abortController.signal,
      });

      console.log('\n=== Demo Summary ===');
      console.log(`Arrived:   ${stats.arrived}/${patientCount}`);
      console.log(`Priority:  ${stats.priority}`);
      console.log(`Cancelled: ${stats.cancelled}`);
      console.log(`Served:    ${stats.served}`);
      console.log(`No-shows:  ${stats.noShow}`);
      console.log('====================\n');
    }

    process.exit(0);
  } catch (err) {
    console.error(`\n[ERROR] Simulation failed: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
