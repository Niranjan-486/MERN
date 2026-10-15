import '@testing-library/jest-dom/vitest';
import * as matchers from 'vitest-axe/matchers';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

expect.extend(matchers);

if (!import.meta.env.VITE_API_URL) {
  import.meta.env.VITE_API_URL = 'http://localhost:3000';
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
});
