import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { urlBase64ToUint8Array, arrayBufferToBase64Url, areKeysEqual } from './urlBase64ToUint8Array';

/**
 * Checks whether the current device is iOS running outside standalone PWA mode.
 * On iOS, Web Push is only supported if added to the Home Screen.
 */
export function isIosNeedsInstall() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;
  if (!isIos) return false;
  const isStandalone =
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return !isStandalone;
}

/**
 * Checks whether Web Push and Service Workers are supported in the current environment.
 */
export function isPushSupported() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return 'Notification' in window && 'serviceWorker' in navigator;
}

/**
 * Cleans up push subscription on logout.
 * Unsubscribes locally and deletes subscription from server.
 */
export async function cleanupPushSubscription() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      try {
        await api.delete('/api/push/subscriptions', { body: { endpoint } });
      } catch (_) {}
      await sub.unsubscribe();
    }
  } catch (err) {
    console.warn('Failed to clean up push subscription on logout:', err);
  }
}

/**
 * React hook to manage Web Push notifications.
 *
 * Statuses:
 * - 'unsupported': browser lacks PushManager or ServiceWorker
 * - 'needs-install': iOS Safari outside standalone PWA
 * - 'blocked': Notification.permission is 'denied'
 * - 'off': push is supported and permission not denied, but subscription is inactive
 * - 'enabling': subscription in progress
 * - 'on': active push subscription registered
 * - 'error': error occurred during check or subscription
 */
export function usePushNotifications() {
  const [status, setStatus] = useState('off');
  const [error, setError] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  const checkStatus = useCallback(async () => {
    if (isIosNeedsInstall()) {
      setStatus('needs-install');
      return;
    }

    if (!isPushSupported()) {
      setStatus('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setStatus('blocked');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setStatus('off');
        return;
      }

      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setStatus('off');
        return;
      }

      // Check current public key from server to detect key rotation
      let keyData;
      try {
        keyData = await api.get('/api/push/public-key');
      } catch (err) {
        if (err.status === 503) {
          // Push channel disabled on server
          setStatus('off');
          return;
        }
        throw err;
      }

      const serverPublicKey = keyData?.publicKey;
      if (!serverPublicKey) {
        setStatus('off');
        return;
      }

      // Check if current subscription matches server public key
      const currentAppKey = sub.options?.applicationServerKey;
      const keysMatch = areKeysEqual(currentAppKey, serverPublicKey);

      if (!keysMatch) {
        // Key rotation detected: unsubscribe old and re-subscribe with new key
        try {
          await api.delete('/api/push/subscriptions', { body: { endpoint: sub.endpoint } });
        } catch (_) {}
        await sub.unsubscribe();

        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(serverPublicKey),
        });

        const p256dh = newSub.getKey ? arrayBufferToBase64Url(newSub.getKey('p256dh')) : '';
        const auth = newSub.getKey ? arrayBufferToBase64Url(newSub.getKey('auth')) : '';

        await api.post('/api/push/subscriptions', {
          endpoint: newSub.endpoint,
          keys: { p256dh, auth },
        });

        setStatus('on');
        return;
      }

      // Key matches: ensure server has current subscription registered
      const p256dh = sub.getKey ? arrayBufferToBase64Url(sub.getKey('p256dh')) : '';
      const auth = sub.getKey ? arrayBufferToBase64Url(sub.getKey('auth')) : '';
      try {
        await api.post('/api/push/subscriptions', {
          endpoint: sub.endpoint,
          keys: { p256dh, auth },
        });
      } catch (_) {}

      setStatus('on');
    } catch (err) {
      console.warn('Error checking push subscription status:', err);
      setError(err.message || 'Failed to check push status');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const enable = async () => {
    setError(null);
    if (isIosNeedsInstall()) {
      setStatus('needs-install');
      return;
    }
    if (!isPushSupported()) {
      setStatus('unsupported');
      return;
    }

    try {
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'denied') {
          setStatus('blocked');
          return;
        }
        if (permission !== 'granted') {
          setStatus('off');
          return;
        }
      } else if (Notification.permission === 'denied') {
        setStatus('blocked');
        return;
      }

      setStatus('enabling');

      // Register or get existing service worker
      await navigator.serviceWorker.register('/sw.js');
      const reg = await navigator.serviceWorker.ready;

      // Fetch public key
      const { publicKey } = await api.get('/api/push/public-key');
      if (!publicKey) {
        throw new Error('VAPID public key not available from server');
      }

      // Unsubscribe any stale subscription first
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        try {
          await api.delete('/api/push/subscriptions', { body: { endpoint: existingSub.endpoint } });
        } catch (_) {}
        await existingSub.unsubscribe();
      }

      // Subscribe to PushManager
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const p256dh = sub.getKey ? arrayBufferToBase64Url(sub.getKey('p256dh')) : '';
      const auth = sub.getKey ? arrayBufferToBase64Url(sub.getKey('auth')) : '';

      // Register subscription on server
      await api.post('/api/push/subscriptions', {
        endpoint: sub.endpoint,
        keys: { p256dh, auth },
      });

      setStatus('on');
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
      setError(err.message || 'Failed to enable push notifications');
      setStatus('error');
    }
  };

  const disable = async () => {
    setError(null);
    try {
      if (isPushSupported()) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            const endpoint = sub.endpoint;
            try {
              await api.delete('/api/push/subscriptions', { body: { endpoint } });
            } catch (_) {}
            await sub.unsubscribe();
          }
        }
      }
      setStatus('off');
    } catch (err) {
      console.error('Failed to disable push notifications:', err);
      setError(err.message || 'Failed to disable push notifications');
      setStatus('error');
    }
  };

  const sendTest = async () => {
    setIsTesting(true);
    setTestSuccess(false);
    setError(null);
    try {
      await api.post('/api/push/test');
      setTestSuccess(true);
      setTimeout(() => setTestSuccess(false), 4000);
    } catch (err) {
      console.error('Test push notification failed:', err);
      const msg = err.status === 429
        ? 'Please wait a few seconds before sending another test.'
        : (err.message || 'Failed to send test push notification');
      setError(msg);
    } finally {
      setIsTesting(false);
    }
  };

  return {
    status,
    error,
    isTesting,
    testSuccess,
    enable,
    disable,
    sendTest,
    refresh: checkStatus,
  };
}
