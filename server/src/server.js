const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');

// Load all models so Mongoose registers their schemas and creates indexes
require('./models');

async function start() {
  try {
    await connectDB();
    app.listen(env.PORT, () => {
      console.log(`SmartQueue server listening on port ${env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
