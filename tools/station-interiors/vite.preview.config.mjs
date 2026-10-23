import { defineConfig } from 'vite';
// Local reference review only. The game build remains the repository's main
// Vinext configuration; this server does not publish a second application.
export default defineConfig({
  cacheDir: '.cache/vite-station-preview',
  server: {
    host: '127.0.0.1',
    port: 3201,
    open: '/tools/station-interiors/preview.html',
  },
});
