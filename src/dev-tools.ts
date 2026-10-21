import type { GeoJSONSource } from 'maplibre-gl';
import type { Poi } from './data';
import { distance, type LngLat } from './geo';
import { pick } from './i18n';
import type { Fix, LocationTracker } from './location';
import type { ParkMap } from './map';

/**
 * Developer mode tools (?mode=dev + PIN). Spanish only: not shown to visitors.
 *
 * - Mover: drag points on the map to correct them (kept on this device).
 * - Punto: save the current GPS position, averaged over 10 s, with a name.
 * - Camino: record a walked path.
 * - Exportar: one JSON file with the moves ("points", read by
 *   scripts/gen-park-data.py from data/position-overrides.json) and the
 *   recorded points/paths ("captured", GeoJSON).
 */

const MOVES_KEY = 'oasismap.overrides';
const CAPTURE_KEY = 'oasismap.capture';
const SESSION_KEY = 'oasismap.dev';
const SAMPLE_MS = 10_000;
const TRACK_STEP_M = 3;
const TRACK_MAX_ACCURACY_M = 15;

interface CapturedPoint {
  name: string;
  coord: LngLat;
  accuracy: number;
  samples: number;
  time: string;
}

interface Capture {
  points: CapturedPoint[];
  tracks: LngLat[][];
}

type Tool = 'move' | 'point' | 'track' | null;

const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  move: icon('<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  point: icon('<path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Z"/><circle cx="12" cy="11" r="2"/>'),
  track: icon('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>'),
  more: icon('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
};

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? '') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    alert('No se pudo guardar en el móvil. Exporta los datos ahora.');
  }
}

export function startDevTools(
  pmap: ParkMap,
  tracker: LocationTracker,
  pois: Poi[],
  onMoved: (poi: Poi, coord: LngLat) => void,
): void {
  const moves = read<Record<string, LngLat>>(MOVES_KEY, {});
  const capture = read<Capture>(CAPTURE_KEY, { points: [], tracks: [] });
  const original = new Map(pois.map((p) => [p.id, p.coord]));
  const byId = new Map(pois.map((p) => [p.id, p]));
  const history: { id: string; before: LngLat }[] = [];
  let tool: Tool = null;
  let recording: LngLat[] | null = null;
  let sampling: Fix[] | null = null;
  let flash = '';
  let flashTimer = 0;

  // --- UI -------------------------------------------------------------------
  const root = document.createElement('div');
  root.className = 'dev';
  root.innerHTML = `
    <div class="dev-status" hidden></div>
    <div class="dev-menu" hidden>
      <button type="button" data-act="export">Exportar ajustes</button>
      <button type="button" data-act="undo">Deshacer último movimiento</button>
      <button type="button" data-act="reset">Restablecer posiciones</button>
      <button type="button" data-act="clear">Borrar puntos y caminos grabados</button>
      <button type="button" data-act="exit">Salir del modo dev</button>
    </div>
    <nav class="dev-bar" aria-label="Herramientas de desarrollo">
      <span class="dev-badge">DEV<small id="dev-acc">—</small></span>
      <button type="button" class="dev-tool" data-tool="move">${ICON.move}<span>Mover</span></button>
      <button type="button" class="dev-tool" data-tool="point">${ICON.point}<span>Punto</span></button>
      <button type="button" class="dev-tool" data-tool="track">${ICON.track}<span>Camino</span></button>
      <button type="button" class="dev-tool dev-more" aria-label="Más opciones">${ICON.more}</button>
    </nav>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const status = $('.dev-status');
  const menu = $('.dev-menu');

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const render = () => {
    for (const b of root.querySelectorAll<HTMLElement>('[data-tool]')) {
      const t = b.dataset.tool as Tool;
      const active = t === tool || (t === 'track' && !!recording) || (t === 'point' && !!sampling);
      b.classList.toggle('active', active);
    }
    $('[data-tool="track"] span').textContent = recording ? 'Parar' : 'Camino';
    $<HTMLButtonElement>('[data-act="undo"]').disabled = history.length === 0;
    const moved = Object.keys(moves).length;
    const recorded = capture.points.length + capture.tracks.filter((t) => t.length >= 2).length;
    $('[data-act="export"]').textContent = `Exportar ajustes (${moved + recorded})`;

    let text = flash;
    if (!text && sampling) text = 'Quieto 10 segundos: midiendo la posición…';
    else if (!text && recording) text = `Grabando camino · ${recording.length} puntos`;
    else if (!text && tool === 'move') text = `Arrastra un punto para moverlo · ${plural(moved, 'movido', 'movidos')}`;
    status.hidden = !text;
    status.textContent = text;
  };

  const say = (text: string) => {
    flash = text;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => ((flash = ''), render()), 2200);
    render();
  };

  // --- moves ----------------------------------------------------------------
  const apply = (poi: Poi, coord: LngLat) => {
    pmap.movePoi(poi.id, coord);
    onMoved(poi, coord);
  };
  for (const [id, coord] of Object.entries(moves)) {
    const poi = byId.get(id);
    if (poi) apply(poi, coord);
  }
  const onDragEnd = (poi: Poi, coord: LngLat) => {
    history.push({ id: poi.id, before: moves[poi.id] ?? original.get(poi.id)! });
    moves[poi.id] = coord;
    write(MOVES_KEY, moves);
    onMoved(poi, coord);
    say(`Movido: ${pick(poi.name)}`);
  };

  // --- capture ----------------------------------------------------------------
  const map = pmap.map;
  const draw = () => {
    (map.getSource('capture') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [
        ...capture.points.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p.coord } })),
        ...capture.tracks.map((t) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: t } })),
      ],
    });
  };
  const saveCapture = () => {
    write(CAPTURE_KEY, capture);
    draw();
  };
  const setupLayers = () => {
    map.addSource('capture', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'capture-lines', type: 'line', source: 'capture', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#a71d2f', 'line-width': 3 } });
    map.addLayer({
      id: 'capture-points',
      type: 'circle',
      source: 'capture',
      filter: ['==', '$type', 'Point'],
      paint: { 'circle-color': '#a71d2f', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
    });
    draw();
  };
  if (map.isStyleLoaded()) setupLayers();
  else map.once('load', setupLayers);

  tracker.addListener((f: Fix) => {
    $('#dev-acc').textContent = `±${Math.round(f.accuracy)} m`;
    sampling?.push(f);
    if (recording && f.accuracy <= TRACK_MAX_ACCURACY_M) {
      const last = recording[recording.length - 1];
      if (!last || distance(last, f.coord) >= TRACK_STEP_M) {
        recording.push(f.coord);
        saveCapture();
        render();
      }
    }
  });

  const capturePoint = () => {
    if (sampling) return;
    const name = prompt('Nombre del punto (p. ej. "jirafas" o "cruce-12"):');
    if (!name) return;
    sampling = tracker.last ? [tracker.last] : [];
    render();
    setTimeout(() => {
      const fixes = sampling ?? [];
      sampling = null;
      if (fixes.length === 0) return say('Sin señal GPS: no se ha guardado.');
      let w = 0, lng = 0, lat = 0; // weighted mean: accurate fixes count more
      for (const f of fixes) {
        const wi = 1 / Math.max(1, f.accuracy) ** 2;
        w += wi;
        lng += f.coord[0] * wi;
        lat += f.coord[1] * wi;
      }
      capture.points.push({
        name,
        coord: [+(lng / w).toFixed(7), +(lat / w).toFixed(7)],
        accuracy: Math.round(Math.min(...fixes.map((f) => f.accuracy)) * 10) / 10,
        samples: fixes.length,
        time: new Date().toISOString(),
      });
      saveCapture();
      say(`Punto guardado: ${name}`);
    }, SAMPLE_MS);
  };

  const toggleTrack = () => {
    if (recording) {
      if (recording.length < 2) capture.tracks.pop();
      recording = null;
      say('Camino guardado');
    } else {
      recording = tracker.last ? [tracker.last.coord] : [];
      capture.tracks.push(recording);
    }
    saveCapture();
    render();
  };

  // --- actions --------------------------------------------------------------
  const exportAll = () => {
    const file = {
      exported: new Date().toISOString(),
      points: Object.fromEntries(Object.entries(moves).map(([id, coord]) => [id, { name: pick(byId.get(id)?.name), coord }])),
      captured: {
        type: 'FeatureCollection',
        features: [
          ...capture.points.map((p) => ({
            type: 'Feature',
            properties: { name: p.name, accuracy: p.accuracy, samples: p.samples, time: p.time },
            geometry: { type: 'Point', coordinates: p.coord },
          })),
          ...capture.tracks
            .filter((t) => t.length >= 2)
            .map((t) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t } })),
        ],
      },
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
    a.download = 'position-overrides.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const undo = () => {
    const last = history.pop();
    if (!last) return;
    const orig = original.get(last.id)!;
    if (last.before[0] === orig[0] && last.before[1] === orig[1]) delete moves[last.id];
    else moves[last.id] = last.before;
    write(MOVES_KEY, moves);
    apply(byId.get(last.id)!, last.before);
    say('Movimiento deshecho');
  };

  const actions: Record<string, () => void> = {
    export: exportAll,
    undo,
    reset: () => {
      if (!confirm('¿Devolver todos los puntos movidos a su posición original? Exporta antes si quieres guardarlos.')) return;
      for (const id of Object.keys(moves)) {
        const poi = byId.get(id);
        if (poi) apply(poi, original.get(id)!);
        delete moves[id];
      }
      history.length = 0;
      write(MOVES_KEY, moves);
      say('Posiciones restablecidas');
    },
    clear: () => {
      if (!confirm('¿Borrar los puntos y caminos grabados? Exporta antes si quieres guardarlos.')) return;
      capture.points = [];
      capture.tracks = [];
      recording = null;
      saveCapture();
      say('Grabaciones borradas');
    },
    exit: () => {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
      location.href = location.pathname;
    },
  };

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!el) return;
    if (el.classList.contains('dev-more')) {
      menu.hidden = !menu.hidden;
      return;
    }
    menu.hidden = true;
    if (el.dataset.act) return actions[el.dataset.act]();
    switch (el.dataset.tool) {
      case 'move':
        tool = tool === 'move' ? null : 'move';
        pmap.setMoveMode(tool === 'move', onDragEnd);
        break;
      case 'point':
        capturePoint();
        break;
      case 'track':
        toggleTrack();
        break;
    }
    render();
  });

  render();
}
