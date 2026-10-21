import type { Poi } from './data';
import type { LngLat } from './geo';
import { pick } from './i18n';
import type { ParkMap } from './map';

/**
 * Developer tool: drag points on the map to correct their position.
 * Moves are kept on this device (localStorage) and exported as
 * position-overrides.json, which scripts/gen-park-data.py applies on the
 * next data build (put it in data/position-overrides.json).
 */

const KEY = 'oasismap.overrides';

type Overrides = Record<string, LngLat>;

function load(): Overrides {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Overrides;
  } catch {
    return {};
  }
}

export function startMoveTool(
  panel: HTMLElement,
  pmap: ParkMap,
  pois: Poi[],
  onMoved: (poi: Poi, coord: LngLat) => void,
): void {
  const moves = load();
  const history: { id: string; before: LngLat }[] = [];
  const original = new Map(pois.map((p) => [p.id, p.coord]));
  const byId = new Map(pois.map((p) => [p.id, p]));

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(moves));
    } catch {
      /* storage full or blocked: export now */
    }
  };

  const apply = (poi: Poi, coord: LngLat) => {
    pmap.movePoi(poi.id, coord);
    onMoved(poi, coord);
  };

  // Moves saved earlier on this device show up straight away.
  for (const [id, coord] of Object.entries(moves)) {
    const poi = byId.get(id);
    if (poi) apply(poi, coord);
  }

  const row = document.createElement('div');
  row.className = 'cap-row';
  row.innerHTML = `
    <button type="button" id="mv-toggle">✋ Mover puntos</button>
    <button type="button" id="mv-undo">↶</button>
    <button type="button" id="mv-export">⬇ Ajustes</button>
    <button type="button" id="mv-reset">⟲</button>`;
  const status = document.createElement('div');
  status.className = 'cap-info';
  panel.append(row, status);
  const btn = (id: string) => row.querySelector<HTMLButtonElement>(`#${id}`)!;

  let on = false;
  const render = () => {
    const n = Object.keys(moves).length;
    btn('mv-toggle').textContent = on ? '✅ Listo' : '✋ Mover puntos';
    btn('mv-undo').disabled = history.length === 0;
    status.textContent = on
      ? `Arrastra un punto para moverlo · ${n} movido${n === 1 ? '' : 's'}`
      : `${n} punto${n === 1 ? '' : 's'} movido${n === 1 ? '' : 's'} en este móvil`;
  };

  const onDragEnd = (poi: Poi, coord: LngLat) => {
    history.push({ id: poi.id, before: moves[poi.id] ?? original.get(poi.id)! });
    moves[poi.id] = coord;
    save();
    onMoved(poi, coord);
    status.textContent = `Movido: ${pick(poi.name)}`;
    setTimeout(render, 1500);
  };

  btn('mv-toggle').addEventListener('click', () => {
    on = !on;
    pmap.setMoveMode(on, onDragEnd);
    render();
  });

  btn('mv-undo').addEventListener('click', () => {
    const last = history.pop();
    if (!last) return;
    const poi = byId.get(last.id)!;
    const orig = original.get(last.id)!;
    if (last.before[0] === orig[0] && last.before[1] === orig[1]) delete moves[last.id];
    else moves[last.id] = last.before;
    save();
    apply(poi, last.before);
    render();
  });

  btn('mv-export').addEventListener('click', () => {
    const points = Object.fromEntries(
      Object.entries(moves).map(([id, coord]) => [id, { name: pick(byId.get(id)?.name), coord }]),
    );
    const file = { exported: new Date().toISOString(), points };
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'position-overrides.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  btn('mv-reset').addEventListener('click', () => {
    if (!confirm('¿Devolver todos los puntos movidos a su posición original? Exporta antes si quieres guardarlos.')) return;
    for (const id of Object.keys(moves)) {
      const poi = byId.get(id);
      if (poi) apply(poi, original.get(id)!);
      delete moves[id];
    }
    history.length = 0;
    save();
    render();
  });

  render();
}
