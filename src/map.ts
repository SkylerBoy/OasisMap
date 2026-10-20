import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CATEGORY_ICON, type ParkData, type Poi } from './data';
import { circlePolygon, type LngLat } from './geo';
import { pick } from './i18n';
import type { Fix } from './location';

export type BaseLayer = 'osm' | 'pnoa';

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
      route: { type: 'geojson', data: EMPTY },
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
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
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
      el.className = `poi-marker cat-${poi.category}`;
      el.type = 'button';
      el.innerHTML = `<span class="poi-icon">${CATEGORY_ICON[poi.category] ?? '📍'}</span>${
        poi.number ? `<span class="poi-num">${poi.number}</span>` : ''
      }`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers.onPoiClick(poi);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat(poi.coord).addTo(this.map);
      this.poiMarkers.set(poi.id, { marker, el, poi });
    }
    this.relabel();
  }

  get hasOverlay(): boolean {
    return !!this.data.config.overlay;
  }

  /** Update marker labels after a language change. */
  relabel(): void {
    for (const { el, poi } of this.poiMarkers.values()) el.setAttribute('aria-label', pick(poi.name));
  }

  setBase(base: BaseLayer): void {
    this.base = base;
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
