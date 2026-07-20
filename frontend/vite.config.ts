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
        // 转发时附带 X-Forwarded-For，让后端能看到手机/平板等真实客户端 IP
        xfwd: true,
        timeout: 300000,
      },
      '/uploads': {
        target: 'http://localhost:3101',
        changeOrigin: true,
        xfwd: true,
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
