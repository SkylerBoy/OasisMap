// Builds a version for hosts with a strict CSP (e.g. a claude.ai artifact):
// MapLibre's worker ships as its own file and the HTML is reduced to page
// content (the host adds doctype/head/body). Output: dist-artifact/
import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const out = 'dist-artifact';
execSync(`npx vite build --outDir ${out} --emptyOutDir`, {
  stdio: 'inherit',
  env: { ...process.env, VITE_MAPLIBRE_WORKER: './maplibre-gl-csp-worker.js', VITE_NO_TILES: '1' },
});
copyFileSync('node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js', `${out}/maplibre-gl-csp-worker.js`);

const html = readFileSync(`${out}/index.html`, 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const keep = (head.match(/<(script|link)[^>]*(type="module"|rel="stylesheet")[^>]*>(<\/script>)?/g) ?? []).join('\n');
const page = `<title>Oasis Wildlife Map</title>
<meta name="theme-color" content="#8c1c2c">
${keep}
${body.trim()}
`;
writeFileSync(`${out}/index.html`, page);
console.log('artifact build ready in', out);
