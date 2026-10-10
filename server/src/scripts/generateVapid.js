const webpush = require('web-push');

/**
 * Generates a fresh VAPID keypair for Web Push notifications.
 * Output is formatted as .env lines ready to be copied into .env.
 */
function generateVapidKeys() {
  const vapidKeys = webpush.generateVAPIDKeys();
  console.log('# Web Push (VAPID) Credentials');
  console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  console.log('VAPID_SUBJECT=mailto:admin@smartqueue.local');
}

generateVapidKeys();
