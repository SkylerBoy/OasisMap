import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

/**
 * After the build, tell the service worker which files make up this version
 * (index + hashed assets), so it can keep a complete, consistent copy.
 */
function swManifest(): Plugin {
  return {
    name: 'sw-manifest',
    apply: 'build',
    closeBundle() {
      const assets = readdirSync('dist/assets').map((f: string) => `./assets/${f}`);
      const version = createHash('sha1').update(assets.join(',')).digest('hex').slice(0, 10);
      const sw = readFileSync('dist/sw.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('[/*__ASSETS__*/]', JSON.stringify(assets));
      writeFileSync('dist/sw.js', sw);
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any folder (GitHub Pages, subpaths…).
  base: './',
  // MapLibre alone is ~800 kB; it is cached by the service worker after the first visit.
  build: { chunkSizeWarningLimit: 1500 },
  plugins: [swManifest()],
  test: { environment: 'node' },
} as any);
