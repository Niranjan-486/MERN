const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { Organization, Service, Counter, User, Token } = require('../models');

async function seed() {
  try {
    await connectDB();

    const host = mongoose.connection.host || 'unknown';
    const dbName = mongoose.connection.name || 'unknown';

    console.log(`\nAbout to seed database "${dbName}" on host "${host}"...`);

    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());
    const hasYesFlag = process.argv.includes('--yes');

    if (!isLocalhost && !hasYesFlag) {
      console.error(
        `\n[ERROR] Seed aborted: Target host "${host}" is not localhost.\n` +
        `To seed a remote or production database, you must pass the --yes flag:\n` +
        `  npm run seed -- --yes\n`
      );
      await mongoose.connection.close();
      process.exit(1);
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

    // 3. Three active counters
    const counterNames = ['Counter 1', 'Counter 2', 'Counter 3'];
    const counters = [];
    for (const name of counterNames) {
      const counter = await Counter.findOneAndUpdate(
        { serviceId: service._id, name },
        { serviceId: service._id, name, status: 'active' },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      counters.push(counter);
      console.log(`Counter [${counter.name}]: ${counter._id}`);
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
    counters.forEach((c) => console.log(`Counter ID (${c.name}): ${c._id}`));
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

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seed();
