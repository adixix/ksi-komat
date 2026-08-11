import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function buildStamp() {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {}
  return JSON.stringify({
    version: process.env.npm_package_version || 'dev',
    commit,
    builtAt: new Date().toISOString(),
  });
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_STAMP__: buildStamp(),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/feed.rss': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
