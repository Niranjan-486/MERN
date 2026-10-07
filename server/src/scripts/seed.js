const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { Organization, Service, Counter, User, Token } = require('../models');

async function seed() {
  try {
    await connectDB();
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

    // 4. Staff User
    const staffUser = await User.findOneAndUpdate(
      { phone: '+919999900000' },
      {
        phone: '+919999900000',
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
      const phone = `+91999990000${i}`;
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

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seed();
