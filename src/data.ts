import type { LngLat } from './geo';

/** Text per language code, e.g. { es: 'Jirafas', en: 'Giraffes' }. */
export type Localized = Record<string, string | undefined>;

export const CATEGORIES = ['animal', 'show', 'food', 'experience', 'botanic', 'service'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Icon names from src/poi-icons.ts, used for chips and points without their own. */
export const CATEGORY_ICON: Record<Category, string> = {
  animal: 'paw',
  show: 'show',
  food: 'restaurant',
  experience: 'camel',
  botanic: 'cactus',
  service: 'info',
};

export function poiIcon(poi: Poi): string {
  return poi.icon ?? CATEGORY_ICON[poi.category];
}

export interface Poi {
  id: string;
  category: Category;
  /** Number shown on the printed park map, if any. */
  number?: string;
  name: Localized;
  description?: Localized;
  /** Free text, e.g. "11:30 · 15:00". */
  schedule?: string;
  /** Photo path under public/, e.g. img/poi/flamencos.jpg (placeholder when missing). */
  image?: string;
  /** Icon name from src/poi-icons.ts. */
  icon?: string;
  /** Secondary point (toilets, viewpoints…): only drawn when zoomed in. */
  minor?: boolean;
  coord: LngLat;
}

export interface ParkConfig {
  name: string;
  /** true while coordinates are placeholders, shows a banner. */
  demoData: boolean;
  center: LngLat;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  bounds: [LngLat, LngLat];
  base: 'osm' | 'pnoa';
  /** Georeferenced illustrated map: image corners top-left, top-right, bottom-right, bottom-left. */
  overlay: { url: string; coordinates: [LngLat, LngLat, LngLat, LngLat]; opacity?: number } | null;
  /** Metres per second, for walking time estimates. */
  walkingSpeed: number;
}

export interface ParkData {
  config: ParkConfig;
  pois: Poi[];
  paths: LngLat[][];
}

const base = import.meta.env.BASE_URL;

async function getJson<T>(file: string): Promise<T> {
  // Always revalidate: park data changes with each deploy.
  const res = await fetch(`${base}data/${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface FeatureCollection {
  features: { geometry: { type: string; coordinates: any }; properties: any }[];
}

export async function loadPark(): Promise<ParkData> {
  const [config, poiFc, pathFc] = await Promise.all([
    getJson<ParkConfig>('config.json'),
    getJson<FeatureCollection>('pois.geojson'),
    getJson<FeatureCollection>('paths.geojson'),
  ]);

  const pois: Poi[] = poiFc.features
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => ({ ...f.properties, coord: f.geometry.coordinates as LngLat }));

  const paths: LngLat[][] = [];
  for (const f of pathFc.features) {
    if (f.geometry?.type === 'LineString') paths.push(f.geometry.coordinates);
    else if (f.geometry?.type === 'MultiLineString') paths.push(...f.geometry.coordinates);
  }
  return { config, pois, paths };
}
