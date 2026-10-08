import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (!import.meta.env.VITE_API_URL) {
  import.meta.env.VITE_API_URL = 'http://localhost:3000';
}

afterEach(() => {
  cleanup();
});
