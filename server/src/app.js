const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const healthRouter = require('./routes/health');
const { router: authRouter } = require('./routes/auth');
const meRouter = require('./routes/me');
const servicesRouter = require('./routes/services');
const countersRouter = require('./routes/counters');
const tokensRouter = require('./routes/tokens');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// CORS configuration (allow CLIENT_ORIGIN only)
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  })
);

// Body parsing
app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/services', servicesRouter);
app.use('/api/counters', countersRouter);
app.use('/api/tokens', tokensRouter);

// Central error handler
app.use(errorHandler);

module.exports = app;
