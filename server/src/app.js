const express = require('express');
const healthRouter = require('./routes/health');
const servicesRouter = require('./routes/services');
const countersRouter = require('./routes/counters');
const tokensRouter = require('./routes/tokens');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Body parsing
app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/api/services', servicesRouter);
app.use('/api/counters', countersRouter);
app.use('/api/tokens', tokensRouter);

// Central error handler
app.use(errorHandler);

module.exports = app;
