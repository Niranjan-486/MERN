const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const healthRouter = require('./routes/health');
const readyRouter = require('./routes/ready');
const { router: authRouter } = require('./routes/auth');
const meRouter = require('./routes/me');
const servicesRouter = require('./routes/services');
const countersRouter = require('./routes/counters');
const tokensRouter = require('./routes/tokens');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Trust reverse proxy (Render) so req.ip reflects the real client IP
app.set('trust proxy', 1);

// CORS configuration (allows all configured origins with trailing slashes stripped)
app.use(
  cors({
    origin: env.CLIENT_ORIGINS,
    credentials: true,
  })
);

// Body parsing
app.use(express.json());

// Probes
app.use('/health', healthRouter);
app.use('/ready', readyRouter);
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/services', servicesRouter);
app.use('/api/counters', countersRouter);
app.use('/api/tokens', tokensRouter);

// Central error handler
app.use(errorHandler);

module.exports = app;
