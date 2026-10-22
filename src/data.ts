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
  /** Opening hours (park time), e.g. ["9:00", "17:30"]. */
  hours?: [string, string];
  /** Start times (park time): exhibitions or Ecotour departures from this stop. */
  times?: string[];
  timesKind?: 'show' | 'train';
  /** Only on these weekdays (0 = Sunday … 6 = Saturday); every day if missing. */
  days?: number[];
  /** Photo path under public/, e.g. img/poi/flamencos.jpg (placeholder when missing). */
  image?: string;
  /** Drawing cut from the printed map, used as the map marker. */
  art?: string;
  /** Drawing size on the printed map (pt), so drawings keep their relative size. */
  artSize?: [number, number];
  /** Fixed 2-character code for shared plan links. */
  code?: string;
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
  /** Supabase project for anonymous visit times (empty: off). See docs/supabase.md. */
  stats?: { url: string; key: string };
}

/** IUCN Red List category of the species; DOM = domestic animal. */
export type Iucn = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'DOM';

export interface Individual {
  name: string;
  sex: 'm' | 'f';
  /** Year of birth. */
  born: number;
  /** Year it arrived at the park. */
  arrived: number;
  origin: Localized;
  story: Localized;
}

export interface SpeciesInfo {
  iucn: Iucn;
  /** Which species, when the point has several (the status is this one's). */
  species?: Localized;
  individuals: Individual[];
}

export interface ParkData {
  config: ParkConfig;
  pois: Poi[];
  paths: LngLat[][];
  /** Ecotour train route, stop 0 to 5 (empty if not available). */
  ecotour: LngLat[];
  /** Animals living at each point, by point id. */
  animals: Record<string, SpeciesInfo>;
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
  const [config, poiFc, pathFc, ecoFc, animals] = await Promise.all([
    getJson<ParkConfig>('config.json'),
    getJson<FeatureCollection>('pois.geojson'),
    getJson<FeatureCollection>('paths.geojson'),
    getJson<FeatureCollection>('ecotour.geojson').catch(() => ({ features: [] }) as FeatureCollection),
    getJson<Record<string, SpeciesInfo>>('animals.json').catch(() => ({})),
  ]);
  const ecotour: LngLat[] = ecoFc.features.find((f) => f.geometry?.type === 'LineString')?.geometry.coordinates ?? [];

  const pois: Poi[] = poiFc.features
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => ({ ...f.properties, coord: f.geometry.coordinates as LngLat }));

  const paths: LngLat[][] = [];
  for (const f of pathFc.features) {
    if (f.geometry?.type === 'LineString') paths.push(f.geometry.coordinates);
    else if (f.geometry?.type === 'MultiLineString') paths.push(...f.geometry.coordinates);
  }
  return { config, pois, paths, ecotour, animals };
}
