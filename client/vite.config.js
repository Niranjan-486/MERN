import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = process.env.VITE_API_URL || env.VITE_API_URL;

  if (command === 'build' && (!apiUrl || !apiUrl.trim())) {
    throw new Error(
      'Build failed: VITE_API_URL environment variable is required for production build. ' +
      'Please set VITE_API_URL (e.g. VITE_API_URL=https://smartqueue-api-firstmern.onrender.com).'
    );
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/tests/setup.js',
    },
  };
});
