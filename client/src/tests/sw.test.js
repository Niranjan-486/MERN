import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Service Worker (sw.js) unit test (Test g)', () => {
  let listeners = {};
  let fakeSelf;
  let showNotificationMock;
  let skipWaitingMock;
  let claimMock;
  let matchAllMock;
  let openWindowMock;

  beforeEach(() => {
    listeners = {};
    showNotificationMock = vi.fn().mockResolvedValue(undefined);
    skipWaitingMock = vi.fn().mockResolvedValue(undefined);
    claimMock = vi.fn().mockResolvedValue(undefined);
    matchAllMock = vi.fn().mockResolvedValue([]);
    openWindowMock = vi.fn().mockResolvedValue({});

    fakeSelf = {
      addEventListener: (evt, handler) => {
        listeners[evt] = handler;
      },
      skipWaiting: skipWaitingMock,
      clients: {
        claim: claimMock,
        matchAll: matchAllMock,
        openWindow: openWindowMock,
      },
      registration: {
        showNotification: showNotificationMock,
      },
    };

    // Load sw.js content and execute with fakeSelf as `self`
    const swPath = path.resolve(__dirname, '../../public/sw.js');
    const swCode = fs.readFileSync(swPath, 'utf8');

    // Run swCode with fakeSelf bound to self
    const runSw = new Function('self', swCode);
    runSw(fakeSelf);
  });

  it('registers install and activate events with skipWaiting and claim', async () => {
    expect(listeners.install).toBeDefined();
    expect(listeners.activate).toBeDefined();

    // Test install
    let installWaitPromise = null;
    listeners.install({
      waitUntil: (p) => {
        installWaitPromise = p;
      },
    });
    await installWaitPromise;
    expect(skipWaitingMock).toHaveBeenCalled();

    // Test activate
    let activateWaitPromise = null;
    listeners.activate({
      waitUntil: (p) => {
        activateWaitPromise = p;
      },
    });
    await activateWaitPromise;
    expect(claimMock).toHaveBeenCalled();
  });

  it('push event parses payload defensively and calls showNotification with expected options', async () => {
    expect(listeners.push).toBeDefined();

    const payloadObj = {
      title: 'Your token has been called!',
      body: 'Token #12: Please proceed to Counter 2',
      tag: 'token-66fa',
      requireInteraction: true,
      url: '/tokens/66fa',
    };

    let pushWaitPromise = null;
    listeners.push({
      data: {
        json: () => payloadObj,
      },
      waitUntil: (p) => {
        pushWaitPromise = p;
      },
    });

    await pushWaitPromise;

    expect(showNotificationMock).toHaveBeenCalledWith('Your token has been called!', {
      body: 'Token #12: Please proceed to Counter 2',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'token-66fa',
      renotify: true,
      requireInteraction: true,
      data: { url: '/tokens/66fa' },
      vibrate: [200, 100, 200],
    });
  });

  it('push event falls back gracefully if payload parsing fails or data is absent', async () => {
    let pushWaitPromise = null;
    listeners.push({
      data: null,
      waitUntil: (p) => {
        pushWaitPromise = p;
      },
    });

    await pushWaitPromise;

    expect(showNotificationMock).toHaveBeenCalledWith(
      'Queue Update',
      expect.objectContaining({
        body: 'You have an update on your queue status.',
        icon: '/icons/icon-192.png',
        tag: 'smartqueue-notification',
      })
    );
  });

  it('notificationclick closes notification and focuses matching client window', async () => {
    expect(listeners.notificationclick).toBeDefined();

    const closeMock = vi.fn();
    const focusMock = vi.fn().mockResolvedValue({});
    const clientMock = { url: '/tokens/66fa', focus: focusMock };

    matchAllMock.mockResolvedValue([clientMock]);

    let clickWaitPromise = null;
    listeners.notificationclick({
      notification: {
        close: closeMock,
        data: { url: '/tokens/66fa' },
      },
      waitUntil: (p) => {
        clickWaitPromise = p;
      },
    });

    await clickWaitPromise;

    expect(closeMock).toHaveBeenCalled();
    expect(matchAllMock).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(focusMock).toHaveBeenCalled();
    expect(openWindowMock).not.toHaveBeenCalled();
  });

  it('notificationclick opens a new window if no client matches', async () => {
    const closeMock = vi.fn();
    matchAllMock.mockResolvedValue([]);

    let clickWaitPromise = null;
    listeners.notificationclick({
      notification: {
        close: closeMock,
        data: { url: '/tokens/66fa' },
      },
      waitUntil: (p) => {
        clickWaitPromise = p;
      },
    });

    await clickWaitPromise;

    expect(closeMock).toHaveBeenCalled();
    expect(openWindowMock).toHaveBeenCalledWith('/tokens/66fa');
  });
});
