import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { poiIcon, type ParkData, type Poi } from './data';
import { poiIconSvg } from './poi-icons';
import { circlePolygon, type LngLat } from './geo';
import { pick } from './i18n';
import type { Fix } from './location';

// Hosts that forbid blob: workers (strict CSP) can ship MapLibre's worker as a file.
const workerUrl = import.meta.env.VITE_MAPLIBRE_WORKER as string | undefined;
if (workerUrl) maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);

export type BaseLayer = 'osm' | 'pnoa';

/** Builds for hosts that block external images skip the tiled base maps. */
export const HAS_TILES = !import.meta.env.VITE_NO_TILES;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function style(data: ParkData): StyleSpecification {
  const { config, paths } = data;
  const s: StyleSpecification = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap',
      },
      // Spanish national orthophoto (very high resolution, also in Canarias).
      pnoa: {
        type: 'raster',
        tiles: [
          'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'PNOA © IGN',
      },
      paths: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: paths.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })),
        },
      },
      ecotour: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: data.ecotour.length
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: data.ecotour } }]
            : [],
        },
      },
      route: { type: 'geojson', data: EMPTY },
      plan: { type: 'geojson', data: EMPTY },
      accuracy: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e8efd9' } },
      { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: config.base === 'osm' ? 'visible' : 'none' } },
      { id: 'pnoa', type: 'raster', source: 'pnoa', layout: { visibility: config.base === 'pnoa' ? 'visible' : 'none' } },
      {
        id: 'paths-casing',
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 12] },
      },
      {
        id: 'paths',
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d9c49a', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 8] },
      },
      // Ecotour train route: dashed teal like on the printed map.
      {
        id: 'ecotour-casing',
        type: 'line',
        source: 'ecotour',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 19, 10] },
      },
      {
        id: 'ecotour',
        type: 'line',
        source: 'ecotour',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': '#00454f',
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2, 19, 5],
          'line-dasharray': [1.4, 1.6],
        },
      },
      // the visitor's day plan: under the navigation route
      {
        id: 'plan-casing',
        type: 'line',
        source: 'plan',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 5, 19, 13] },
      },
      {
        id: 'plan',
        type: 'line',
        source: 'plan',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#a3162b', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 19, 7] },
      },
      { id: 'accuracy', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#2f80ed', 'fill-opacity': 0.15 } },
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 16] },
      },
      {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#a3162b', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3.5, 19, 10] },
      },
    ],
  };
  if (!HAS_TILES) {
    delete s.sources.osm;
    delete s.sources.pnoa;
    s.layers = s.layers.filter((l) => l.id !== 'osm' && l.id !== 'pnoa');
  }
  if (config.overlay) {
    s.sources.overlay = { type: 'image', url: config.overlay.url, coordinates: config.overlay.coordinates };
    s.layers.splice(3, 0, {
      id: 'overlay',
      type: 'raster',
      source: 'overlay',
      paint: { 'raster-opacity': config.overlay.opacity ?? 0.9 },
    });
  }
  return s;
}

export interface MapHandlers {
  onPoiClick(poi: Poi): void;
  onMapClick(coord: LngLat): void;
  onBaseFallback(): void;
}

export class ParkMap {
  readonly map: maplibregl.Map;
  private readonly poiMarkers = new Map<string, { marker: maplibregl.Marker; el: HTMLElement; poi: Poi }>();
  private userMarker: maplibregl.Marker | null = null;
  private userEl: HTMLElement | null = null;
  private base: BaseLayer;
  /** Developer mode: markers can be dragged and clicks do not open the sheet. */
  private moveMode = false;
  private pnoaFailed = false;

  constructor(container: HTMLElement, private readonly data: ParkData, handlers: MapHandlers) {
    const { config } = data;
    this.base = config.base;
    this.map = new maplibregl.Map({
      container,
      style: style(data),
      center: config.center,
      zoom: config.zoom,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      maxBounds: config.bounds,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    // Bottom-left so it does not sit under the map buttons on the right.
    this.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'Iconos: Fluent Emoji (MIT) · <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> (CC BY 3.0)',
      }),
      'bottom-left',
    );
    // Start collapsed (just the ⓘ button); MapLibre opens it on wide maps.
    this.map.once('load', () =>
      container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'),
    );
    this.map.on('click', (e) => handlers.onMapClick([e.lngLat.lng, e.lngLat.lat]));
    this.map.on('error', (e: any) => {
      if (e.sourceId === 'pnoa' && !this.pnoaFailed) {
        this.pnoaFailed = true;
        this.setBase('osm');
        handlers.onBaseFallback();
      }
    });

    for (const poi of data.pois) {
      const el = document.createElement('button');
      el.className = `poi-marker cat-${poi.category}${poi.minor ? ' minor' : ''}${poi.art ? ' art' : ''}`;
      el.type = 'button';
      const face = poi.art
        ? `<img class="poi-art" src="${import.meta.env.BASE_URL}${poi.art}" alt="" draggable="false">`
        : `<span class="poi-icon">${poiIconSvg(poiIcon(poi), 20)}</span>`;
      if (poi.art && poi.artSize) {
        el.style.setProperty('--aw', String(poi.artSize[0]));
        el.style.setProperty('--ah', String(poi.artSize[1]));
      }
      el.innerHTML = `${face}${
        poi.number ? `<span class="poi-num">${poi.number}</span>` : ''
      }`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!this.moveMode) handlers.onPoiClick(poi);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat(poi.coord).addTo(this.map);
      this.makeDraggable(el, marker, poi);
      this.poiMarkers.set(poi.id, { marker, el, poi });
    }
    this.relabel();

    // Zoom classes: smaller markers far out, secondary points only up close.
    const mapEl = this.map.getContainer();
    const onZoom = () => {
      const z = this.map.getZoom();
      mapEl.classList.toggle('z-far', z < 16.6);
      mapEl.classList.toggle('z-near', z >= 17.4);
      // Drawings grow and shrink with the map, like on the printed map, within limits.
      mapEl.style.setProperty('--art-k', Math.min(1.4, Math.max(0.6, 0.85 * 2 ** ((z - 17) * 0.6))).toFixed(3));
    };
    this.map.on('zoom', onZoom);
    onZoom();
    this.watchTheme();
  }

  get hasOverlay(): boolean {
    return !!this.data.config.overlay;
  }

  /** Update marker labels after a language change. */
  relabel(): void {
    for (const { el, poi } of this.poiMarkers.values()) el.setAttribute('aria-label', pick(poi.name));
  }

  /** Dark map when the phone (or the page) is in dark mode. */
  private watchTheme(): void {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const isDark = () => {
      const forced = document.documentElement.dataset.theme;
      return forced ? forced === 'dark' : mq.matches;
    };
    const apply = () => this.applyTheme(isDark());
    mq.addEventListener('change', apply);
    // style.load fires before the tiles arrive, so the first frame already has the right colours
    if (this.map.isStyleLoaded()) apply();
    else this.map.once('style.load', apply);
  }

  private applyTheme(dark: boolean): void {
    const m = this.map;
    const paint = (layer: string, prop: string, value: unknown) => {
      if (m.getLayer(layer)) m.setPaintProperty(layer, prop, value);
    };
    paint('bg', 'background-color', dark ? '#1b2019' : '#e8efd9');
    // OSM: invert the brightness and turn the hues back, so green stays green but dark.
    paint('osm', 'raster-brightness-min', dark ? 0.82 : 0);
    paint('osm', 'raster-brightness-max', dark ? 0.06 : 1);
    paint('osm', 'raster-hue-rotate', dark ? 180 : 0);
    paint('osm', 'raster-saturation', dark ? -0.35 : 0);
    paint('osm', 'raster-contrast', dark ? -0.1 : 0);
    // Orthophoto: just dimmed.
    paint('pnoa', 'raster-brightness-max', dark ? 0.62 : 1);
    paint('pnoa', 'raster-saturation', dark ? -0.2 : 0);
    paint('paths-casing', 'line-color', dark ? '#11150f' : '#ffffff');
    paint('paths-casing', 'line-opacity', dark ? 0.55 : 0.8);
    paint('paths', 'line-color', dark ? '#8f7f5c' : '#d9c49a');
    paint('ecotour-casing', 'line-color', dark ? '#11150f' : '#ffffff');
    paint('ecotour', 'line-color', dark ? '#4fb3bf' : '#00454f');
    paint('route-casing', 'line-color', dark ? '#11150f' : '#ffffff');
    paint('route', 'line-color', dark ? '#e0485c' : '#a3162b');
  }

  setBase(base: BaseLayer): void {
    this.base = base;
    if (!HAS_TILES) return;
    const apply = () => {
      this.map.setLayoutProperty('osm', 'visibility', base === 'osm' ? 'visible' : 'none');
      this.map.setLayoutProperty('pnoa', 'visibility', base === 'pnoa' ? 'visible' : 'none');
    };
    if (this.map.isStyleLoaded()) apply();
    else this.map.once('load', apply);
  }

  get currentBase(): BaseLayer {
    return this.base;
  }

  setOverlayVisible(visible: boolean): void {
    if (this.hasOverlay) this.map.setLayoutProperty('overlay', 'visibility', visible ? 'visible' : 'none');
  }

  /** Developer mode: drag markers to move points (mouse or finger). */
  setMoveMode(on: boolean, onMoved?: (poi: Poi, coord: LngLat) => void): void {
    this.moveMode = on;
    this.onMoved = onMoved ?? null;
    this.map.getContainer().classList.toggle('move-mode', on);
  }

  private onMoved: ((poi: Poi, coord: LngLat) => void) | null = null;

  /** Pointer-based dragging; MapLibre's own marker drag pans the map here instead. */
  private makeDraggable(el: HTMLElement, marker: maplibregl.Marker, poi: Poi): void {
    let dragging = false;
    let moved = false;
    el.addEventListener('pointerdown', (e) => {
      if (!this.moveMode) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      dragging = true;
      moved = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const r = this.map.getContainer().getBoundingClientRect();
      marker.setLngLat(this.map.unproject([e.clientX - r.left, e.clientY - r.top]));
      moved = true;
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      el.releasePointerCapture(e.pointerId);
      if (moved && this.onMoved) {
        const p = marker.getLngLat();
        this.onMoved(poi, [+p.lng.toFixed(7), +p.lat.toFixed(7)]);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // Keep the map from panning underneath (it listens to mouse/touch events).
    for (const type of ['mousedown', 'touchstart'] as const) {
      el.addEventListener(type, (e) => this.moveMode && e.stopPropagation(), { passive: true });
    }
  }

  movePoi(id: string, coord: LngLat): void {
    this.poiMarkers.get(id)?.marker.setLngLat(coord);
  }

  highlight(id: string | null): void {
    for (const [pid, { el }] of this.poiMarkers) el.classList.toggle('selected', pid === id);
  }

  /** Show only POIs whose id is in `ids` (null = all). */
  filter(ids: Set<string> | null): void {
    for (const [pid, { el }] of this.poiMarkers) el.style.display = !ids || ids.has(pid) ? '' : 'none';
  }

  setUser(fix: Fix | null, heading: number | null): void {
    const whenReady = (fn: () => void) => (this.map.isStyleLoaded() ? fn() : this.map.once('load', fn));
    if (!fix) {
      this.userMarker?.remove();
      this.userMarker = null;
      whenReady(() => (this.map.getSource('accuracy') as GeoJSONSource).setData(EMPTY));
      return;
    }
    if (!this.userMarker) {
      this.userEl = document.createElement('div');
      this.userEl.className = 'user-marker';
      this.userEl.innerHTML = '<div class="user-cone"></div><div class="user-dot"></div>';
      this.userMarker = new maplibregl.Marker({ element: this.userEl }).setLngLat(fix.coord).addTo(this.map);
    }
    this.userMarker.setLngLat(fix.coord);
    const cone = this.userEl!.firstElementChild as HTMLElement;
    cone.style.display = heading == null ? 'none' : '';
    if (heading != null) cone.style.transform = `rotate(${heading}deg)`;
    whenReady(() =>
      (this.map.getSource('accuracy') as GeoJSONSource).setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [circlePolygon(fix.coord, Math.min(fix.accuracy, 80))] },
      }),
    );
  }

  setRoute(coords: LngLat[] | null): void {
    const fc: GeoJSON.FeatureCollection = coords
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] }
      : EMPTY;
    const apply = () => (this.map.getSource('route') as GeoJSONSource).setData(fc);
    if (this.map.isStyleLoaded()) apply();
    else this.map.once('load', apply);
  }

  /**
   * Show the day plan: its route, and on each planned point its stop number
   * instead of the printed-map number (other points show no number meanwhile).
   */
  setPlan(stops: Map<string, string> | null, coords: LngLat[] | null): void {
    const fc: GeoJSON.FeatureCollection = coords?.length
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] }
      : EMPTY;
    const apply = () => (this.map.getSource('plan') as GeoJSONSource).setData(fc);
    if (this.map.isStyleLoaded()) apply();
    else this.map.once('load', apply);
    for (const { el, poi } of this.poiMarkers.values()) {
      let num = el.querySelector<HTMLElement>('.poi-num');
      const stop = stops?.get(poi.id);
      if (stop && !num) {
        num = document.createElement('span');
        num.className = 'poi-num';
        el.appendChild(num);
      }
      if (!num) continue;
      num.textContent = stop ?? poi.number ?? '';
      num.classList.toggle('plan-num', !!stop);
      num.hidden = (!!stops && !stop) || !num.textContent;
      el.classList.toggle('in-plan', !!stop);
    }
  }

  fitTo(points: LngLat[], padding: number | maplibregl.PaddingOptions = 60): void {
    if (points.length === 0) return;
    const b = new maplibregl.LngLatBounds(points[0], points[0]);
    for (const p of points) b.extend(p);
    this.map.fitBounds(b, { padding, maxZoom: 18.5, duration: 600 });
  }

  centerOn(coord: LngLat, zoom?: number): void {
    this.map.easeTo({ center: coord, zoom: zoom ?? Math.max(this.map.getZoom(), 17.5), duration: 500 });
  }

  resize(): void {
    this.map.resize();
  }
}
