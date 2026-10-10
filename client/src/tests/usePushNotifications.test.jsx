import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { usePushNotifications } from '../push/usePushNotifications';
import { api } from '../lib/api';
import { urlBase64ToUint8Array } from '../push/urlBase64ToUint8Array';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('usePushNotifications hook (Test f)', () => {
  const MOCK_PUBLIC_KEY =
    'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DQA';
  const OLD_PUBLIC_KEY =
    'BEl7q1r_954Kz4yW1H2_8n3uY6cO_VvG1K_8a3m9e4b7x2z5v8s1d4f7g0h3j6k9l2m5n8p1q4r7s0t3u6v9w2x';

  let originalNotification;
  let originalNavigator;
  let mockSubscription;
  let mockPushManager;
  let mockRegistration;

  beforeEach(() => {
    vi.clearAllMocks();

    originalNotification = global.Notification;
    originalNavigator = global.navigator;

    const mockKeyBytes = urlBase64ToUint8Array(MOCK_PUBLIC_KEY);

    mockSubscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/fake-endpoint',
      options: {
        applicationServerKey: mockKeyBytes.buffer,
      },
      getKey: vi.fn((name) => {
        if (name === 'p256dh') return new Uint8Array([1, 2, 3]).buffer;
        if (name === 'auth') return new Uint8Array([4, 5, 6]).buffer;
        return null;
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };

    mockPushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(mockSubscription),
    };

    mockRegistration = {
      pushManager: mockPushManager,
    };

    // Global Notification mock
    global.Notification = {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };

    // Navigator mocks
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        serviceWorker: {
          register: vi.fn().mockResolvedValue(mockRegistration),
          getRegistration: vi.fn().mockResolvedValue(mockRegistration),
          ready: Promise.resolve(mockRegistration),
        },
      },
      writable: true,
      configurable: true,
    });

    // Default API mock responses
    api.get.mockImplementation(async (url) => {
      if (url === '/api/push/public-key') {
        return { publicKey: MOCK_PUBLIC_KEY };
      }
      return {};
    });

    api.post.mockResolvedValue({ success: true });
    api.delete.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    global.Notification = originalNotification;
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('detects unsupported environment when Notification is missing', async () => {
    delete global.Notification;
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});
    expect(result.current.status).toBe('unsupported');
  });

  it('detects blocked status when Notification.permission is denied', async () => {
    global.Notification.permission = 'denied';
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});
    expect(result.current.status).toBe('blocked');
  });

  it('detects needs-install on iOS Safari outside standalone mode', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        ...global.navigator,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)',
      },
      writable: true,
      configurable: true,
    });
    // window.navigator.standalone is false / undefined
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});
    expect(result.current.status).toBe('needs-install');
  });

  it('subscribes successfully on enable()', async () => {
    mockPushManager.getSubscription.mockResolvedValue(null);

    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});
    expect(result.current.status).toBe('off');

    await act(async () => {
      await result.current.enable();
    });

    expect(global.navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(api.get).toHaveBeenCalledWith('/api/push/public-key');
    expect(mockPushManager.subscribe).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      expect.objectContaining({
        endpoint: mockSubscription.endpoint,
      })
    );
    expect(result.current.status).toBe('on');
  });

  it('unsubscribes and deletes subscription on disable()', async () => {
    mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});
    expect(result.current.status).toBe('on');

    await act(async () => {
      await result.current.disable();
    });

    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      expect.objectContaining({
        body: { endpoint: mockSubscription.endpoint },
      })
    );
    expect(result.current.status).toBe('off');
  });

  it('key rotation: detects mismatched key on mount, unsubscribes old, and re-subscribes with new key', async () => {
    const oldKeyBytes = urlBase64ToUint8Array(OLD_PUBLIC_KEY);
    const staleSubscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/old-endpoint',
      options: {
        applicationServerKey: oldKeyBytes.buffer,
      },
      getKey: vi.fn((name) => {
        if (name === 'p256dh') return new Uint8Array([7, 8]).buffer;
        if (name === 'auth') return new Uint8Array([9, 10]).buffer;
        return null;
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };

    mockPushManager.getSubscription.mockResolvedValue(staleSubscription);

    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});

    // Old subscription should be removed
    expect(staleSubscription.unsubscribe).toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      expect.objectContaining({
        body: { endpoint: staleSubscription.endpoint },
      })
    );

    // Re-subscribed with new public key
    expect(mockPushManager.subscribe).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      expect.objectContaining({
        endpoint: mockSubscription.endpoint,
      })
    );
    expect(result.current.status).toBe('on');
  });

  it('sendTest calls /api/push/test and records test success', async () => {
    mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {});

    await act(async () => {
      await result.current.sendTest();
    });

    expect(api.post).toHaveBeenCalledWith('/api/push/test');
    expect(result.current.testSuccess).toBe(true);
  });
});
