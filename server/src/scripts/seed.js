const path = require('path');
const dotenv = require('dotenv');

// Load .env from server/ root and current working directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB } = require('../config/db');
const { Organization, Service, Counter, User, Token } = require('../models');

async function seed(options = {}) {
  try {
    const mongoUri =
      options.mongoUri ||
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      env.MONGODB_URI ||
      env.MONGO_URI;

    if (!mongoUri && mongoose.connection.readyState !== 1) {
      console.error(
        '\n[ERROR] Seed aborted: MONGODB_URI environment variable is missing.\n' +
        'Please set MONGODB_URI in your environment or .env file before running seed.\n'
      );
      if (options.exitOnError !== false) {
        process.exit(1);
      }
      throw new Error('MONGODB_URI environment variable is missing');
    }

    if (mongoose.connection.readyState !== 1) {
      await connectDB(mongoUri);
    }

    const host = mongoose.connection.host || 'unknown';
    const dbName = mongoose.connection.name || 'unknown';

    console.log(`\nAbout to seed database "${dbName}" on host "${host}"...`);

    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());
    const argv = options.argv || process.argv;
    const hasYesFlag = argv.includes('--yes');

    if (!isLocalhost && !hasYesFlag) {
      console.error(
        `\n[ERROR] Seed aborted: Target host "${host}" is not localhost.\n` +
        `To seed a remote or production database, you must pass the --yes flag:\n` +
        `  npm run seed -- --yes\n`
      );
      if (options.closeConnection !== false) {
        await mongoose.connection.close();
      }
      if (options.exitOnError !== false) {
        process.exit(1);
      }
      throw new Error(`Target host "${host}" is not localhost and --yes was not provided`);
    }

    console.log('Syncing database indexes...');
    await Token.syncIndexes();

    console.log('Seeding initial data...');

    // 1. Organization
    const organization = await Organization.findOneAndUpdate(
      { name: 'City General Hospital' },
      { name: 'City General Hospital', type: 'hospital' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Organization [${organization.name}]: ${organization._id}`);

    // 2. Service ("General OPD")
    const service = await Service.findOneAndUpdate(
      { organizationId: organization._id, name: 'General OPD' },
      {
        organizationId: organization._id,
        name: 'General OPD',
        avgServiceTimeSec: 300,
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Service [${service.name}]: ${service._id}`);

    // 3. Exactly one active counter: "Counter 1"
    const counter1 = await Counter.findOneAndUpdate(
      { serviceId: service._id, name: 'Counter 1' },
      { serviceId: service._id, name: 'Counter 1', status: 'active' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Counter [${counter1.name}]: ${counter1._id} (active)`);

    // Reconcile other counters for the seeded service
    const otherCounters = await Counter.find({
      serviceId: service._id,
      _id: { $ne: counter1._id },
    });

    for (const c of otherCounters) {
      const activeToken = await Token.findOne({
        counterId: c._id,
        status: { $in: ['called', 'serving'] },
      });

      if (activeToken) {
        console.warn(
          `[WARNING] Counter "${c.name}" has an active token (status: ${activeToken.status}). Leaving untouched. Please finish or skip that token first.`
        );
      } else {
        const anyToken = await Token.findOne({ counterId: c._id });
        if (!anyToken) {
          await Counter.deleteOne({ _id: c._id });
          console.log(`Counter [${c.name}]: deleted (no token referenced it)`);
        } else {
          await Counter.updateOne({ _id: c._id }, { status: 'offline' });
          console.log(`Counter [${c.name}]: set to offline (referenced by past tokens)`);
        }
      }
    }

    // Clean up any legacy seeded phones with '+' prefix
    await User.deleteMany({
      phone: {
        $in: [
          '+919999900000',
          '+919999900001',
          '+919999900002',
          '+919999900003',
          '+919999900004',
          '+919999900005',
        ],
      },
    });

    // 4. Staff User (associated with organization)
    const staffUser = await User.findOneAndUpdate(
      { phone: '9999900000' },
      {
        phone: '9999900000',
        name: 'Staff Member',
        role: 'staff',
        organizationId: organization._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Staff User [${staffUser.name}]: ${staffUser._id}`);

    // 5. Five Patients
    const patients = [];
    for (let i = 1; i <= 5; i++) {
      const phone = `999990000${i}`;
      const name = `Patient ${i}`;
      const patient = await User.findOneAndUpdate(
        { phone },
        { phone, name, role: 'patient' },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      patients.push(patient);
      console.log(`Patient [${patient.name}]: ${patient._id}`);
    }

    console.log('\n--- Seed complete. Summary of IDs ---');
    console.log(`Organization ID : ${organization._id}`);
    console.log(`Service ID      : ${service._id}`);
    console.log(`Counter ID (${counter1.name}): ${counter1._id}`);
    console.log(`Staff User ID   : ${staffUser._id}`);
    patients.forEach((p) => console.log(`Patient ID (${p.name}): ${p._id}`));

    console.log('\n--- Login Credentials & Instructions ---');
    console.log('1. PATIENT LOGIN:');
    console.log('   Phone: 9999900001 (or any new phone)');
    console.log('   OTP Code: Defined in env var OTP_CODE (default: 123456)');
    console.log('   Command:');
    console.log(
      '   curl -X POST http://localhost:3000/api/auth/verify-otp -H "Content-Type: application/json" -d \'{"phone":"9999900001","otp":"123456"}\''
    );
    console.log('\n2. STAFF LOGIN:');
    console.log(`   Phone: 9999900000 (Staff Member)`);
    console.log('   OTP Code: Defined in env var STAFF_OTP_CODE (default: staffsecret123)');
    console.log('   Command:');
    console.log(
      '   curl -X POST http://localhost:3000/api/auth/verify-otp -H "Content-Type: application/json" -d \'{"phone":"9999900000","otp":"staffsecret123"}\''
    );

    if (options.closeConnection !== false) {
      await mongoose.connection.close();
    }
    return { organization, service, counter: counter1, staffUser, patients };
  } catch (err) {
    const safeMsg = (err.message || String(err)).replace(
      /(mongodb(?:\+srv)?:\/\/)([^:@\s]+):([^@\s]+)@/g,
      '$1***:***@'
    );
    console.error('Seed failed:', safeMsg);
    if (options.closeConnection !== false) {
      try {
        await mongoose.connection.close();
      } catch (_) {}
    }
    if (options.exitOnError !== false) {
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seed };
