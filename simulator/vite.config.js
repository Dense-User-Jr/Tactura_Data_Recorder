import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // three.js alone is ~500 kB minified; that's fine for a locally served tool.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    open: true,
    port: 5173,
    strictPort: false, // if 5173 is busy, Vite picks the next free port
    // v1 stays on localhost. Phone IMU streaming (future, spec §15) will need
    // LAN access (`host: true`) plus HTTPS, because browsers only expose
    // devicemotion to secure origins.
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
