import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LngLat } from './geo';
import { PathGraph } from './graph';

const read = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8'));
const pois = read('pois.geojson').features as { properties: { id: string; name: Record<string, string> }; geometry: { coordinates: LngLat } }[];
const paths = (read('paths.geojson').features as { geometry: { coordinates: LngLat[] } }[]).map((f) => f.geometry.coordinates);
const graph = PathGraph.fromLines(paths);

describe('park data', () => {
  it('has unique ids and a Spanish name for every point', () => {
    const ids = pois.map((p) => p.properties.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of pois) expect(p.properties.name.es, p.properties.id).toBeTruthy();
  });

  it('every point is near a path and reachable from the entrance', () => {
    const entrance = pois.find((p) => p.properties.id === 'entrada')!.geometry.coordinates;
    for (const p of pois) {
      const snap = graph.snap(p.geometry.coordinates);
      expect(snap.dist, `${p.properties.id} is ${Math.round(snap.dist)} m from a path`).toBeLessThan(80);
      expect(graph.route(entrance, p.geometry.coordinates), p.properties.id).not.toBeNull();
    }
  });
});
