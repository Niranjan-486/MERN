/**
 * Converts a base64url-encoded string to a Uint8Array suitable for applicationServerKey.
 * @param {string} base64String
 * @returns {Uint8Array}
 */
export function urlBase64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    throw new Error('Invalid base64 string provided');
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Converts an ArrayBuffer to a base64url string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function arrayBufferToBase64Url(buffer) {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Compares an applicationServerKey ArrayBuffer with a base64url public key string.
 * @param {ArrayBuffer|null} keyBuffer
 * @param {string} base64UrlString
 * @returns {boolean}
 */
export function areKeysEqual(keyBuffer, base64UrlString) {
  if (!keyBuffer || !base64UrlString) return false;
  try {
    const currentBytes = new Uint8Array(keyBuffer);
    const expectedBytes = urlBase64ToUint8Array(base64UrlString);
    if (currentBytes.length !== expectedBytes.length) return false;
    for (let i = 0; i < currentBytes.length; i++) {
      if (currentBytes[i] !== expectedBytes[i]) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}
