const { io } = require('socket.io-client');
const env = require('../config/env');

const token = process.argv[2];
if (!token) {
  console.error('Usage: npm run watch -- <jwt>');
  process.exit(1);
}

console.log(`Connecting to http://localhost:${env.PORT} with JWT...`);

const socket = io(`http://localhost:${env.PORT}`, {
  auth: { token },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log(`[CONNECTED] Socket ID: ${socket.id}`);
});

socket.on('token:updated', (data) => {
  console.log('[EVENT token:updated]:', JSON.stringify(data, null, 2));
});

socket.on('queue:updated', (data) => {
  console.log('[EVENT queue:updated]:', JSON.stringify(data, null, 2));
});

socket.on('connect_error', (err) => {
  console.error('[ERROR] Connection refused:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('[DISCONNECTED]:', reason);
});
