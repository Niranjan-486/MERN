const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const mongoose = require('mongoose');
const { Service, User, Token, Notification, PushSubscription, TokenSequence } = require('../../src/models');
const { getQueueDate } = require('../../src/utils/queueDate');
const { connectDB } = require('../../src/config/db');

/**
 * Checks if target host is localhost. Requires --yes if non-localhost.
 */
function checkHostSafety(connection, hasYesFlag) {
  const host = connection.host || 'unknown';
  const dbName = connection.name || 'unknown';
  console.log(`Target database: "${dbName}" on host "${host}"`);

  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());
  if (!isLocalhost && !hasYesFlag) {
    throw new Error(
      `Target host "${host}" is not localhost. To run against a remote database, pass --yes.`
    );
  }
}

/**
 * Prepares the seeded service with a baseline average service time.
 */
async function prepareService({ avg = 180, serviceName = 'General OPD' } = {}) {
  let service = await Service.findOne({ name: serviceName });
  if (!service) {
    service = await Service.findOne({ isActive: true });
  }
  if (!service) {
    throw new Error('No active service found to prepare');
  }

  service.avgServiceTimeSec = Number(avg);
  service.serviceSamples = 5;
  await service.save();

  return {
    serviceId: service._id.toString(),
    serviceName: service.name,
    avgServiceTimeSec: service.avgServiceTimeSec,
    serviceSamples: service.serviceSamples,
  };
}

/**
 * Cleans up simulated patient data and optionally resets numbering if safe.
 */
async function cleanupSimData({ resetNumbering = false } = {}) {
  const today = getQueueDate();

  // Find all simulated patients (phone starting with 00000)
  const simUsers = await User.find({ phone: /^00000/ }).select('_id phone name');
  const simUserIds = simUsers.map((u) => u._id);

  let deletedTokensCount = 0;
  let deletedNotificationsCount = 0;
  let deletedPushSubsCount = 0;
  let deletedUsersCount = 0;

  if (simUserIds.length > 0) {
    const tokenRes = await Token.deleteMany({ userId: { $in: simUserIds } });
    deletedTokensCount = tokenRes.deletedCount;

    const notifRes = await Notification.deleteMany({ userId: { $in: simUserIds } });
    deletedNotificationsCount = notifRes.deletedCount;

    const pushRes = await PushSubscription.deleteMany({ userId: { $in: simUserIds } });
    deletedPushSubsCount = pushRes.deletedCount;

    const userRes = await User.deleteMany({ _id: { $in: simUserIds } });
    deletedUsersCount = userRes.deletedCount;
  }

  // Reset service avg service time
  const services = await Service.find({ isActive: true });
  for (const s of services) {
    s.avgServiceTimeSec = 300;
    s.serviceSamples = 0;
    await s.save();
  }

  let resetNumberingResult = 'not_requested';
  if (resetNumbering) {
    // Check if any non-simulated tokens were issued today
    const nonSimTokensCount = await Token.countDocuments({
      queueDate: today,
      userId: { $nin: simUserIds },
    });

    if (nonSimTokensCount > 0) {
      console.warn(
        `[WARNING] Cannot reset numbering: ${nonSimTokensCount} non-simulated token(s) exist for today (${today}). Preserving sequence.`
      );
      resetNumberingResult = 'refused_real_tokens_exist';
    } else {
      await TokenSequence.deleteMany({ queueDate: today });
      resetNumberingResult = 'deleted';
    }
  }

  return {
    deletedUsersCount,
    deletedTokensCount,
    deletedNotificationsCount,
    deletedPushSubsCount,
    resetNumberingResult,
  };
}

async function runCli() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const hasYesFlag = argv.includes('--yes');

  if (!command || !['prepare', 'cleanup'].includes(command)) {
    console.log(
      'Usage: npm run sim:db -- <command> [options]\n\n' +
      'Commands:\n' +
      '  prepare [--avg <seconds>] [--yes]   Set service baseline avgServiceTimeSec (default 180s) and serviceSamples: 5\n' +
      '  cleanup [--reset-numbering] [--yes] Remove sim patients (^00000), tokens, notifs, and reset avg to 300s\n'
    );
    process.exit(1);
  }

  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    'mongodb://localhost:27017/smartqueue';

  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDB(mongoUri);
    }

    checkHostSafety(mongoose.connection, hasYesFlag);

    if (command === 'prepare') {
      let avg = 180;
      const avgIdx = argv.indexOf('--avg');
      if (avgIdx !== -1 && argv[avgIdx + 1]) {
        avg = parseInt(argv[avgIdx + 1], 10) || 180;
      }

      const res = await prepareService({ avg });
      console.log(
        `[sim:db prepare] Successfully updated service "${res.serviceName}" (${res.serviceId}):\n` +
        `  avgServiceTimeSec: ${res.avgServiceTimeSec}s\n` +
        `  serviceSamples: ${res.serviceSamples}`
      );
    } else if (command === 'cleanup') {
      const resetNumbering = argv.includes('--reset-numbering');
      const res = await cleanupSimData({ resetNumbering });
      console.log(
        `[sim:db cleanup] Cleanup completed:\n` +
        `  Simulated patients removed: ${res.deletedUsersCount}\n` +
        `  Simulated tokens removed:   ${res.deletedTokensCount}\n` +
        `  Notifications removed:      ${res.deletedNotificationsCount}\n` +
        `  Push subscriptions removed: ${res.deletedPushSubsCount}\n` +
        `  Reset numbering result:     ${res.resetNumberingResult}\n` +
        `  Service ETA baselines reset to default 300s (0 samples).`
      );
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error(`\n[ERROR] sim:db failed: ${err.message}`);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  checkHostSafety,
  prepareService,
  cleanupSimData,
};
