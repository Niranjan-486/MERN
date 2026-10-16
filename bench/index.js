const path = require('path');
// Ensure server/node_modules is resolvable before requiring external packages
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const { getEnvInfo } = require('./envInfo');
const { MetricsCollector } = require('./metricsCollector');
const { startEphemeralServer } = require('./serverRunner');
const { resetScenarioDb } = require('./dbReset');
const { runBurstScenario } = require('./scenarios/burst');
const { runFlowScenario } = require('./scenarios/flow');
const { runReconnectScenario } = require('./scenarios/reconnect');
const { BenchmarkReporter } = require('./reporter');

function parseArgs(argv) {
  const args = {
    api: null,
    scenarios: 'all',
    concurrency: null,
    reporter: 'spec',
    yes: false,
    staffPhone: process.env.STAFF_PHONE || '9999900000',
    staffCode: process.env.STAFF_CODE || process.env.STAFF_OTP_CODE || 'staffsecret123',
    patientCode: process.env.PATIENT_CODE || process.env.OTP_CODE || '123456',
    simulatorKey: process.env.SIMULATOR_KEY || 'smartqueue-bench-simulator-key-2026-safe',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--api' && argv[i + 1]) {
      args.api = argv[++i];
    } else if (arg === '--scenarios' && argv[i + 1]) {
      args.scenarios = argv[++i];
    } else if (arg === '--concurrency' && argv[i + 1]) {
      args.concurrency = parseInt(argv[++i], 10);
    } else if (arg === '--reporter' && argv[i + 1]) {
      args.reporter = argv[++i];
    } else if (arg === '--yes') {
      args.yes = true;
    }
  }

  return args;
}

function checkSafety(apiUrl, hasYesFlag) {
  if (!apiUrl) return;
  try {
    const parsed = new URL(apiUrl);
    const host = parsed.hostname.toLowerCase();
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(host);
    console.log(`Target API URL: ${apiUrl} (host: ${host})`);
    if (!isLocalhost && !hasYesFlag) {
      throw new Error(`Target "${apiUrl}" is not localhost. To run benchmarks against a remote environment, pass --yes.`);
    }
  } catch (err) {
    if (err.message.includes('--yes')) throw err;
    throw new Error(`Invalid API URL "${apiUrl}": ${err.message}`);
  }
}

async function runBenchmark() {
  const args = parseArgs(process.argv.slice(2));

  let apiUrl = args.api;
  let serverHandle = null;
  const isSpawnedServer = !apiUrl;

  try {
    if (isSpawnedServer) {
      console.log('\n[BENCH] No --api specified. Starting ephemeral bench server on isolated database...');
      serverHandle = await startEphemeralServer({
        simulatorKey: args.simulatorKey,
        onLog: (m) => console.log(`[server] ${m}`),
      });
      apiUrl = serverHandle.apiUrl;
    } else {
      checkSafety(apiUrl, args.yes);
    }

    console.log(`\n[BENCH] Target Server: ${apiUrl}`);
    console.log(`[BENCH] Gathering system environment details...`);
    const envInfo = await getEnvInfo({
      apiUrl,
      mongoUri: serverHandle?.mongoUri,
      redisUrl: serverHandle?.redisUrl,
    });

    const scenarioResults = [];

    // Determine scenarios to run
    const runScenarios = [];
    if (args.scenarios === 'all' || args.scenarios === 'burst') {
      if (args.concurrency) {
        runScenarios.push({ type: 'burst', count: args.concurrency });
      } else {
        runScenarios.push({ type: 'burst', count: 100 });
        runScenarios.push({ type: 'burst', count: 250 });
        runScenarios.push({ type: 'burst', count: 500 });
      }
    }
    if (args.scenarios === 'all' || args.scenarios === 'flow') {
      runScenarios.push({ type: 'flow', count: args.concurrency || 300 });
    }
    if (args.scenarios === 'all' || args.scenarios === 'reconnect') {
      runScenarios.push({ type: 'reconnect', count: args.concurrency || 200 });
    }

    // Execute each scenario
    for (const sc of runScenarios) {
      console.log(`\n>>> Preparing Scenario: ${sc.type.toUpperCase()} (N=${sc.count})`);

      // Reset queue data for clean, deterministic state
      const mongoUri = serverHandle?.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017/smartqueue_bench';
      await resetScenarioDb(mongoUri);
      await new Promise((r) => setTimeout(r, 200));

      console.log(`>>> Running Scenario: ${sc.type.toUpperCase()} (N=${sc.count})`);

      // Start background metrics poller
      const metricsCollector = new MetricsCollector({
        apiUrl,
        simulatorKey: args.simulatorKey,
        intervalMs: 1000,
      });
      metricsCollector.start();

      let result;
      try {
        if (sc.type === 'burst') {
          result = await runBurstScenario({
            apiUrl,
            simulatorKey: args.simulatorKey,
            patientCount: sc.count,
            patientCode: args.patientCode,
            onProgress: (m) => console.log(`  ${m}`),
          });
        } else if (sc.type === 'flow') {
          result = await runFlowScenario({
            apiUrl,
            simulatorKey: args.simulatorKey,
            patientCount: sc.count,
            patientCode: args.patientCode,
            staffPhone: args.staffPhone,
            staffCode: args.staffCode,
            onProgress: (m) => console.log(`  ${m}`),
          });
        } else if (sc.type === 'reconnect') {
          result = await runReconnectScenario({
            apiUrl,
            simulatorKey: args.simulatorKey,
            patientCount: sc.count,
            patientCode: args.patientCode,
            onProgress: (m) => console.log(`  ${m}`),
          });
        }
      } finally {
        const metrics = metricsCollector.stop();
        if (result) {
          result.metrics = metrics;
          scenarioResults.push(result);
        }
      }

      console.log(`  Finished ${sc.type} (N=${sc.count}): ${result.passed ? 'PASSED' : 'FAILED'}`);
    }

    // Prepare full benchmark report
    const passedCount = scenarioResults.filter((s) => s.passed).length;
    const totalCount = scenarioResults.length;
    const allPassed = passedCount === totalCount;

    const reportData = {
      timestamp: Date.now(),
      envInfo,
      summary: {
        total: totalCount,
        passedCount,
        failedCount: totalCount - passedCount,
        passed: allPassed,
      },
      scenarios: scenarioResults,
    };

    const reporter = new BenchmarkReporter(reportData);
    const saved = reporter.saveReports();
    console.log(`\n[BENCH] Reports saved to:\n  JSON: ${saved.jsonPath}\n  MD:   ${saved.mdPath}\n  Latest: ${saved.latestJsonPath}`);

    if (args.reporter === 'spec') {
      reporter.printSpec();
    } else if (args.reporter === 'json') {
      console.log(JSON.stringify(reportData, null, 2));
    } else if (args.reporter === 'markdown') {
      console.log(reporter.generateMarkdown());
    }

    if (serverHandle) {
      await serverHandle.stopServer();
    }

    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error(`\n[BENCH ERROR] ${err.message}`);
    if (serverHandle) {
      try {
        await serverHandle.stopServer();
      } catch (_) {}
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runBenchmark();
}

module.exports = {
  runBenchmark,
  parseArgs,
  checkSafety,
};
