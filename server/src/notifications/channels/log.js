module.exports = {
  name: 'log',
  async send(notification) {
    // Structured log containing IDs only, never patient names or phone numbers
    const logLine = JSON.stringify({
      channel: 'log',
      notificationId: notification._id.toString(),
      userId: notification.userId.toString(),
      tokenId: (
        notification.tokenId && (notification.tokenId._id || notification.tokenId)
      ).toString(),
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      sentAt: new Date().toISOString(),
    });
    console.log(`[NOTIFICATION_LOG] ${logLine}`);
  },
};
