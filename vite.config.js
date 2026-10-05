import { defineConfig } from 'vite';

// Relative base so the build can be hosted from any sub-path (e.g. a YouTube Playables bundle).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { host: '0.0.0.0', port: 5173 },
});
