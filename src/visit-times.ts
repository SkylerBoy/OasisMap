import type { Poi } from './data';
import { distance, type LngLat } from './geo';

/**
 * Real visit times. With the visitor's permission, the phone notes how long they
 * stay at each enclosure and sends it anonymously (point + minutes) to Supabase;
 * the planner then uses the median of everyone's stays. See docs/supabase.md.
 */

export interface StatsConfig {
  url: string;
  key: string;
}

const CONSENT = 'oasis.stats.consent'; // 'yes' | 'no'
const QUEUE = 'oasis.stats.queue';
const MEDIANS = 'oasis.stats.medians';
const NEAR_M = 20; // closer than this counts as being at the point
const MIN_STAY = 1.5; // minutes; shorter is walking past
const MAX_STAY = 90;
const GONE_MS = 60_000; // away this long ends the stay

const MEASURED = new Set(['animal', 'show', 'experience', 'botanic']);

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export class VisitTimes {
  private medians = new Map<string, number>();
  private stay: { poi: string; since: number; last: number } | null = null;
  private readonly points: Poi[];

  constructor(
    private readonly cfg: StatsConfig | undefined,
    pois: Poi[],
  ) {
    this.points = pois.filter((p) => MEASURED.has(p.category) && !p.minor);
    try {
      const cached = JSON.parse(store.get(MEDIANS) ?? 'null') as { at: number; m: [string, number][] } | null;
      if (cached) this.medians = new Map(cached.m);
    } catch {
      /* no cache */
    }
  }

  /** Statistics are set up (config.json → stats). */
  get enabled(): boolean {
    return !!this.cfg?.url && !!this.cfg?.key;
  }

  /** null: not asked yet. */
  get consent(): boolean | null {
    const v = store.get(CONSENT);
    return v === 'yes' ? true : v === 'no' ? false : null;
  }

  setConsent(yes: boolean) {
    store.set(CONSENT, yes ? 'yes' : 'no');
    if (!yes) this.stay = null;
  }

  /** Median minutes at a point from everyone's visits, if there are enough. */
  median(poiId: string): number | undefined {
    return this.medians.get(poiId);
  }

  /** Fetch the medians (at most once a day; the last ones are kept for offline use). */
  async loadMedians(): Promise<void> {
    if (!this.enabled) return;
    try {
      const cached = JSON.parse(store.get(MEDIANS) ?? 'null') as { at: number } | null;
      if (cached && Date.now() - cached.at < 86_400_000) return;
      const res = await fetch(`${this.cfg!.url}/rest/v1/poi_times?select=poi,median,n`, { headers: this.headers() });
      if (!res.ok) return;
      const rows = (await res.json()) as { poi: string; median: number }[];
      this.medians = new Map(rows.map((r) => [r.poi, Number(r.median)]));
      store.set(MEDIANS, JSON.stringify({ at: Date.now(), m: [...this.medians] }));
    } catch {
      /* offline: keep the cached ones */
    }
  }

  /** Each GPS fix: start, extend or close a stay at the nearest point. */
  onFix(coord: LngLat, now = Date.now()) {
    if (!this.enabled || this.consent !== true) return;
    let near: Poi | null = null;
    let best = NEAR_M;
    for (const p of this.points) {
      const d = distance(coord, p.coord);
      if (d < best) {
        best = d;
        near = p;
      }
    }
    if (this.stay) {
      if (near?.id === this.stay.poi) {
        this.stay.last = now;
        return;
      }
      // at another point, or away for a while: the stay is over (a short step out is ignored)
      if (near || now - this.stay.last > GONE_MS) this.close();
      else return;
    }
    if (near) this.stay = { poi: near.id, since: now, last: now };
  }

  /** End the current stay and queue it if it is a real visit. */
  close() {
    const s = this.stay;
    this.stay = null;
    if (!s) return;
    const minutes = (s.last - s.since) / 60_000;
    if (minutes < MIN_STAY || minutes > MAX_STAY) return;
    const queue = this.queue();
    queue.push({ poi: s.poi, minutes: Math.round(minutes * 10) / 10 });
    store.set(QUEUE, JSON.stringify(queue.slice(-200)));
    void this.flush();
  }

  /** Send what is waiting; keep it if there is no connection. */
  async flush(): Promise<void> {
    if (!this.enabled || this.consent !== true) return;
    const queue = this.queue();
    if (!queue.length) return;
    try {
      const res = await fetch(`${this.cfg!.url}/rest/v1/visits`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(queue),
      });
      if (res.ok) store.set(QUEUE, '[]');
    } catch {
      /* try again later */
    }
  }

  private queue(): { poi: string; minutes: number }[] {
    try {
      return JSON.parse(store.get(QUEUE) ?? '[]');
    } catch {
      return [];
    }
  }

  private headers(): Record<string, string> {
    const key = this.cfg!.key;
    // new "sb_publishable_…" keys go only in apikey; old JWT "anon" keys also as Bearer
    return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
  }
}
