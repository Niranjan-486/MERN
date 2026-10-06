const express = require('express');
const healthRouter = require('./routes/health');

const app = express();

// Body parsing
app.use(express.json());

// Routes
app.use('/health', healthRouter);

module.exports = app;
