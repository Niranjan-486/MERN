const inapp = require('./inapp');
const log = require('./log');
const push = require('./push');

const channelMap = new Map([
  ['inapp', inapp],
  ['log', log],
  ['push', push],
]);

function getChannel(name) {
  return channelMap.get(name);
}

function registerChannel(channel) {
  channelMap.set(channel.name, channel);
}

function resetChannels() {
  channelMap.clear();
  channelMap.set('inapp', inapp);
  channelMap.set('log', log);
  channelMap.set('push', push);
}

module.exports = {
  getChannel,
  registerChannel,
  resetChannels,
};
