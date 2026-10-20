import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any folder (GitHub Pages, subpaths…).
  base: './',
  // MapLibre alone is ~800 kB; it is cached by the service worker after the first visit.
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
} as any);
