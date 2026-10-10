const { emitNotificationToUser } = require('../../realtime');

module.exports = {
  name: 'inapp',
  async send(notification) {
    emitNotificationToUser(notification.userId, notification);
  },
};
