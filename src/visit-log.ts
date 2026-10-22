import type { Poi } from './data';
import { distance, type LngLat } from './geo';

/**
 * Today's visit, kept only on the phone, for the end-of-visit summary: which
 * animals you saw, how far you walked, how long you were in the park and which
 * exhibitions you watched.
 */
export interface VisitDay {
  date: string;
  /** First and last time seen inside the park (ms). */
  start: number;
  end: number;
  meters: number;
  /** Minutes spent at each point. */
  seen: Record<string, number>;
  /** Where you walked (a point every few metres), to draw your visit on a map. */
  track?: [number, number][];
  /** The summary was already offered on leaving. */
  offered?: boolean;
}

const KEY = 'oasis.visit';
const NEAR_M = 20; // at a point
const SEEN_MIN = 0.75; // this long near a point counts as seeing it
const SHOW_MIN = 10; // this long at an exhibition counts as watching it
const MAX_STEP_M = 80; // bigger jumps between fixes are GPS noise
const MIN_STEP_M = 3; // smaller ones are standing still
const MAX_ACCURACY_M = 35;
const TRACK_STEP_M = 8;
const TRACK_MAX = 4000;

const SEEN_KINDS = new Set(['animal', 'show', 'experience', 'botanic']);

export class VisitLog {
  private day: VisitDay;
  private last: { coord: LngLat; at: number } | null = null;
  private at: { poi: string; since: number } | null = null;
  private readonly points: Poi[];

  constructor(
    pois: Poi[],
    private readonly today: () => string,
  ) {
    this.points = pois.filter((p) => SEEN_KINDS.has(p.category) && !p.minor);
    this.day = this.load();
  }

  private load(): VisitDay {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as VisitDay | null;
      if (d && d.date === this.today()) return d;
    } catch {
      /* nothing kept */
    }
    return { date: this.today(), start: 0, end: 0, meters: 0, seen: {} };
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.day));
    } catch {
      /* private mode */
    }
  }

  /** A new day starts a new visit. */
  private fresh() {
    if (this.day.date !== this.today()) {
      this.day = { date: this.today(), start: 0, end: 0, meters: 0, seen: {} };
      this.last = null;
      this.at = null;
    }
  }

  get visit(): VisitDay {
    this.fresh();
    return this.day;
  }

  /** Something to show: at least one animal seen today. */
  get hasVisit(): boolean {
    return Object.keys(this.visit.seen).length > 0;
  }

  /** Position inside the park. */
  onFix(coord: LngLat, accuracy: number, now = Date.now()) {
    this.fresh();
    const d = this.day;
    if (!d.start) d.start = now;
    d.end = now;
    if (accuracy <= MAX_ACCURACY_M) {
      if (this.last) {
        const step = distance(this.last.coord, coord);
        if (step >= MIN_STEP_M && step <= MAX_STEP_M) d.meters += step;
        const track = (d.track ??= []);
        const lastPoint = track[track.length - 1];
        if (step <= MAX_STEP_M && (!lastPoint || distance(lastPoint, coord) >= TRACK_STEP_M) && track.length < TRACK_MAX)
          track.push([Math.round(coord[0] * 1e6) / 1e6, Math.round(coord[1] * 1e6) / 1e6]);
        if (step >= MIN_STEP_M || now - this.last.at > 60_000) this.last = { coord, at: now };
      } else this.last = { coord, at: now };
    }
    // time near the closest point
    let near: Poi | null = null;
    let best = NEAR_M;
    for (const p of this.points) {
      const dist = distance(coord, p.coord);
      if (dist < best) {
        best = dist;
        near = p;
      }
    }
    if (this.at && this.at.poi !== near?.id) this.at = null;
    if (near) {
      if (!this.at) this.at = { poi: near.id, since: now };
      const minutes = (now - this.at.since) / 60_000;
      if (minutes >= SEEN_MIN) d.seen[near.id] = Math.max(d.seen[near.id] ?? 0, Math.round(minutes * 10) / 10);
    }
    this.save();
  }

  /** A plan stop marked as done counts as seen. */
  markSeen(poiId: string) {
    this.fresh();
    if (!this.points.some((p) => p.id === poiId)) return;
    this.day.seen[poiId] = Math.max(this.day.seen[poiId] ?? 0, SEEN_MIN);
    if (!this.day.start) this.day.start = this.day.end = Date.now();
    this.save();
  }

  /** Mark that the summary was offered on leaving (once a day). */
  setOffered() {
    this.day.offered = true;
    this.save();
  }

  /** Exhibitions watched: long enough at their place. */
  showsWatched(pois: Map<string, Poi>): string[] {
    return Object.entries(this.visit.seen)
      .filter(([id, m]) => pois.get(id)?.category === 'show' && m >= SHOW_MIN)
      .map(([id]) => id);
  }
}
