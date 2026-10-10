import { describe, it, expect } from 'vitest';
import {
  urlBase64ToUint8Array,
  arrayBufferToBase64Url,
  areKeysEqual,
} from '../push/urlBase64ToUint8Array';

describe('urlBase64ToUint8Array utility', () => {
  const sampleBase64Url =
    'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DQA';

  it('converts base64url string to Uint8Array and back cleanly', () => {
    const uint8 = urlBase64ToUint8Array(sampleBase64Url);
    expect(uint8).toBeInstanceOf(Uint8Array);
    expect(uint8.length).toBe(65); // 65 bytes uncompressed P-256 public key

    const roundtrip = arrayBufferToBase64Url(uint8.buffer);
    expect(roundtrip).toBe(sampleBase64Url);
  });

  it('handles strings requiring padding (= and ==)', () => {
    // 2-byte string -> requires '==' padding
    const input = 'AQ'; // 1 byte
    const uint8 = urlBase64ToUint8Array(input);
    expect(uint8.length).toBe(1);
    expect(uint8[0]).toBe(1);
  });

  it('areKeysEqual correctly identifies matching and mismatched keys', () => {
    const uint8 = urlBase64ToUint8Array(sampleBase64Url);
    expect(areKeysEqual(uint8.buffer, sampleBase64Url)).toBe(true);

    const otherKey =
      'BEl7q1r_954Kz4yW1H2_8n3uY6cO_VvG1K_8a3m9e4b7x2z5v8s1d4f7g0h3j6k9l2m5n8p1q4r7s0t3u6v9w2x';
    expect(areKeysEqual(uint8.buffer, otherKey)).toBe(false);
    expect(areKeysEqual(null, sampleBase64Url)).toBe(false);
    expect(areKeysEqual(uint8.buffer, null)).toBe(false);
  });

  it('throws on invalid or empty input for urlBase64ToUint8Array', () => {
    expect(() => urlBase64ToUint8Array('')).toThrow();
    expect(() => urlBase64ToUint8Array(null)).toThrow();
  });
});
