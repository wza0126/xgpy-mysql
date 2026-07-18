import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const resolvePath = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3266,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
        timeout: 300000,
      },
      '/uploads': {
        target: 'http://localhost:3101',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3266,
  },
  resolve: {
    alias: {
      '@': resolvePath('./src'),
      '@components': resolvePath('./src/components'),
      '@hooks': resolvePath('./src/hooks'),
      '@pages': resolvePath('./src/pages'),
      '@utils': resolvePath('./src/utils'),
    },
  },
});
