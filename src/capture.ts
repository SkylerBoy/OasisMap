import type { GeoJSONSource } from 'maplibre-gl';
import { distance, type LngLat } from './geo';
import type { Fix, LocationTracker } from './location';
import type { ParkMap } from './map';

/**
 * Staff tool ("modo desarrollador", open with ?modo=desarrollador and the PIN): walk the park and
 * record exact points (averaged GPS) and paths, then export them as GeoJSON
 * to refine pois.geojson / paths.geojson in QGIS or geojson.io.
 * Spanish only on purpose: it is not shown to visitors.
 */

interface CapturedPoint {
  name: string;
  coord: LngLat;
  accuracy: number;
  samples: number;
  time: string;
}

interface Store {
  points: CapturedPoint[];
  tracks: LngLat[][];
}

const KEY = 'oasismap.capture';
const SAMPLE_MS = 10_000;
const TRACK_STEP_M = 3;
const TRACK_MAX_ACCURACY_M = 15;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '') as Store;
  } catch {
    return { points: [], tracks: [] };
  }
}

export function startCapture(pmap: ParkMap, tracker: LocationTracker): void {
  const store = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      alert('No se pudo guardar en el móvil. Exporta los datos ahora.');
    }
    draw();
  };

  let recording: LngLat[] | null = null;
  let sampling: Fix[] | null = null;

  const panel = document.createElement('div');
  panel.className = 'capture-panel';
  panel.innerHTML = `
    <div class="cap-title">🛠️ Modo desarrollador <span id="cap-acc">—</span></div>
    <div class="cap-row">
      <button type="button" id="cap-point">📍 Punto</button>
      <button type="button" id="cap-track">⏺ Camino</button>
      <button type="button" id="cap-export">⬇ Exportar</button>
      <button type="button" id="cap-clear">🗑</button>
    </div>
    <div id="cap-info" class="cap-info"></div>`;
  document.body.appendChild(panel);
  const q = (id: string) => panel.querySelector<HTMLElement>(`#${id}`)!;

  const info = () => {
    q('cap-info').textContent = `${store.points.length} puntos · ${store.tracks.length} caminos${
      recording ? ` · grabando (${recording.length} vértices)` : ''
    }`;
  };

  tracker.addListener((f: Fix) => {
    q('cap-acc').textContent = `±${Math.round(f.accuracy)} m`;
    sampling?.push(f);
    if (recording && f.accuracy <= TRACK_MAX_ACCURACY_M) {
      const last = recording[recording.length - 1];
      if (!last || distance(last, f.coord) >= TRACK_STEP_M) {
        recording.push(f.coord);
        save();
        info();
      }
    }
  });

  q('cap-point').addEventListener('click', () => {
    if (sampling) return;
    const name = prompt('Nombre o id del punto (p. ej. "cruce-12" o "jirafas"):');
    if (!name) return;
    sampling = tracker.last ? [tracker.last] : [];
    q('cap-point').textContent = '⏳ Quieto 10 s…';
    setTimeout(() => {
      const fixes = sampling ?? [];
      sampling = null;
      q('cap-point').textContent = '📍 Punto';
      if (fixes.length === 0) return alert('Sin señal GPS.');
      // Weighted mean: more accurate fixes count more.
      let w = 0, lng = 0, lat = 0;
      for (const f of fixes) {
        const wi = 1 / Math.max(1, f.accuracy) ** 2;
        w += wi;
        lng += f.coord[0] * wi;
        lat += f.coord[1] * wi;
      }
      const best = Math.min(...fixes.map((f) => f.accuracy));
      store.points.push({
        name,
        coord: [+(lng / w).toFixed(7), +(lat / w).toFixed(7)],
        accuracy: Math.round(best * 10) / 10,
        samples: fixes.length,
        time: new Date().toISOString(),
      });
      save();
      info();
    }, SAMPLE_MS);
  });

  q('cap-track').addEventListener('click', () => {
    if (recording) {
      if (recording.length < 2) store.tracks.pop();
      recording = null;
      q('cap-track').textContent = '⏺ Camino';
    } else {
      recording = tracker.last ? [tracker.last.coord] : [];
      store.tracks.push(recording);
      q('cap-track').textContent = '⏹ Parar';
    }
    save();
    info();
  });

  q('cap-export').addEventListener('click', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        ...store.points.map((p) => ({
          type: 'Feature',
          properties: { name: p.name, accuracy: p.accuracy, samples: p.samples, time: p.time },
          geometry: { type: 'Point', coordinates: p.coord },
        })),
        ...store.tracks
          .filter((tr) => tr.length >= 2)
          .map((tr) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: tr } })),
      ],
    };
    const blob = new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `oasis-captura-${new Date().toISOString().slice(0, 16).replace(':', '')}.geojson`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  q('cap-clear').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los puntos y caminos grabados? Exporta antes.')) return;
    store.points = [];
    store.tracks = [];
    recording = null;
    q('cap-track').textContent = '⏺ Camino';
    save();
    info();
  });

  const map = pmap.map;
  const draw = () => {
    const src = map.getSource('capture') as GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: [
        ...store.points.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p.coord } })),
        ...store.tracks.map((tr) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: tr } })),
      ],
    });
  };
  const setup = () => {
    map.addSource('capture', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'capture-lines', type: 'line', source: 'capture', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#ff7a00', 'line-width': 3 } });
    map.addLayer({
      id: 'capture-points',
      type: 'circle',
      source: 'capture',
      filter: ['==', '$type', 'Point'],
      paint: { 'circle-color': '#ff7a00', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
    });
    draw();
  };
  if (map.isStyleLoaded()) setup();
  else map.once('load', setup);
  info();
}
