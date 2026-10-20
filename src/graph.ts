import { LocalProjection, distance, projectOnSegment, type LngLat, type XY } from './geo';

export interface Edge {
  a: number;
  b: number;
  len: number;
}

/** A point projected onto the nearest walkable path. */
export interface Snap {
  edge: number;
  /** Position along the edge, 0 = edge.a, 1 = edge.b. */
  t: number;
  point: LngLat;
  /** Distance in metres from the original point to the path. */
  dist: number;
}

export interface Route {
  coords: LngLat[];
  /** true where the vertex is a junction (3+ paths meet). Same length as coords. */
  junctions: boolean[];
  length: number;
  from: Snap;
  to: Snap;
}

export interface BuildOptions {
  /** Vertices closer than this (metres) are merged into one node. */
  mergeTolerance?: number;
}

/**
 * Walkable path network built from GeoJSON LineStrings.
 * Every vertex becomes a node; consecutive vertices become edges.
 * Lines only connect where they share (or nearly share) a vertex, or where a
 * line ends on another one (T-junction), so draw paths with snapping on.
 */
export class PathGraph {
  readonly nodes: LngLat[] = [];
  readonly xy: XY[] = [];
  edges: Edge[] = [];
  adj: number[][] = [];
  readonly proj: LocalProjection;
  private readonly tol: number;
  private readonly grid = new Map<string, number[]>();

  private constructor(origin: LngLat, tol: number) {
    this.proj = new LocalProjection(origin);
    this.tol = tol;
  }

  static fromLines(lines: LngLat[][], opts: BuildOptions = {}): PathGraph {
    const first = lines.find((l) => l.length > 0)?.[0];
    if (!first) throw new Error('No paths to build the graph from');
    const g = new PathGraph(first, opts.mergeTolerance ?? 2);
    const seen = new Set<string>();
    for (const line of lines) {
      let prev = -1;
      for (const p of line) {
        const n = g.addNode(p);
        if (prev !== -1 && prev !== n) {
          const key = prev < n ? `${prev}-${n}` : `${n}-${prev}`;
          if (!seen.has(key)) {
            seen.add(key);
            g.edges.push({ a: prev, b: n, len: distance(g.nodes[prev], g.nodes[n]) });
          }
        }
        prev = n;
      }
    }
    g.rebuildAdjacency();
    g.joinTJunctions();
    return g;
  }

  degree(n: number): number {
    return this.adj[n]?.length ?? 0;
  }

  /** Nearest point on the network to p. */
  snap(p: LngLat): Snap {
    const pxy = this.proj.toXY(p);
    let best: Snap | null = null;
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      const s = projectOnSegment(pxy, this.xy[e.a], this.xy[e.b]);
      if (!best || s.dist < best.dist) {
        best = { edge: i, t: s.t, point: this.proj.toLngLat(s.point), dist: s.dist };
      }
    }
    if (!best) throw new Error('Graph has no edges');
    return best;
  }

  /** Shortest walking route between two points (both snapped to the paths). */
  route(from: LngLat | Snap, to: LngLat | Snap): Route | null {
    const s = isSnap(from) ? from : this.snap(from);
    const t = isSnap(to) ? to : this.snap(to);
    const { prev, dist } = this.dijkstra(s, t);
    const T = this.nodes.length + 1;
    if (!isFinite(dist[T])) return null;

    const ids: number[] = [];
    for (let u = T; u !== -1; u = prev[u]) ids.push(u);
    ids.reverse();

    const coords: LngLat[] = [];
    const junctions: boolean[] = [];
    for (const id of ids) {
      const real = id < this.nodes.length;
      const c = id === T ? t.point : real ? this.nodes[id] : s.point;
      const last = coords[coords.length - 1];
      if (last && distance(last, c) < 0.01) continue;
      coords.push(c);
      junctions.push(real && this.degree(id) >= 3);
    }
    if (coords.length === 1) {
      coords.push(coords[0]);
      junctions.push(false);
    }
    return { coords, junctions, length: dist[T], from: s, to: t };
  }

  /** Walking distance from `from` to every node; use with distanceTo(). */
  distancesFrom(from: Snap): Float64Array {
    return this.dijkstra(from, null).dist;
  }

  /** Walking distance to a snapped target using a distancesFrom() result. */
  distanceTo(dist: Float64Array, from: Snap, to: Snap): number {
    const e = this.edges[to.edge];
    let d = Math.min(dist[e.a] + to.t * e.len, dist[e.b] + (1 - to.t) * e.len);
    if (from.edge === to.edge) d = Math.min(d, Math.abs(from.t - to.t) * e.len);
    return d;
  }

  // ---------------------------------------------------------------------------

  private addNode(p: LngLat): number {
    const xy = this.proj.toXY(p);
    const cx = Math.floor(xy[0] / this.tol);
    const cy = Math.floor(xy[1] / this.tol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const n of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = this.xy[n];
          if (Math.hypot(q[0] - xy[0], q[1] - xy[1]) <= this.tol) return n;
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push(p);
    this.xy.push(xy);
    const key = `${cx},${cy}`;
    const cell = this.grid.get(key);
    if (cell) cell.push(id);
    else this.grid.set(key, [id]);
    return id;
  }

  private rebuildAdjacency(): void {
    this.adj = this.nodes.map(() => []);
    this.edges.forEach((e, i) => {
      this.adj[e.a].push(i);
      this.adj[e.b].push(i);
    });
  }

  /** Connect line ends that touch the middle of another segment. */
  private joinTJunctions(): void {
    let changed = false;
    for (let n = 0; n < this.nodes.length; n++) {
      if (this.degree(n) > 1) continue;
      for (let i = 0; i < this.edges.length; i++) {
        const e = this.edges[i];
        if (e.a === n || e.b === n) continue;
        const s = projectOnSegment(this.xy[n], this.xy[e.a], this.xy[e.b]);
        if (s.dist > this.tol || s.t <= 0 || s.t >= 1) continue;
        const b = e.b;
        this.edges[i] = { a: e.a, b: n, len: distance(this.nodes[e.a], this.nodes[n]) };
        this.edges.push({ a: n, b, len: distance(this.nodes[n], this.nodes[b]) });
        changed = true;
        break;
      }
    }
    if (changed) this.rebuildAdjacency();
  }

  /**
   * Dijkstra over the graph plus two virtual nodes: S (= N) sits at `from`
   * on its edge, T (= N + 1) at `to`. With `to` null it explores everything.
   */
  private dijkstra(from: Snap, to: Snap | null): { dist: Float64Array; prev: Int32Array } {
    const N = this.nodes.length;
    const S = N;
    const T = N + 1;
    const dist = new Float64Array(N + 2).fill(Infinity);
    const prev = new Int32Array(N + 2).fill(-1);
    const done = new Uint8Array(N + 2);
    const fe = this.edges[from.edge];
    const te = to ? this.edges[to.edge] : null;
    const heap = new MinHeap();
    dist[S] = 0;
    heap.push(S, 0);

    const relax = (u: number, v: number, w: number) => {
      const d = dist[u] + w;
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
        heap.push(v, d);
      }
    };

    while (heap.size > 0) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === T) break;
      if (u === S) {
        relax(S, fe.a, from.t * fe.len);
        relax(S, fe.b, (1 - from.t) * fe.len);
        if (to && te && to.edge === from.edge) relax(S, T, Math.abs(from.t - to.t) * fe.len);
        continue;
      }
      for (const ei of this.adj[u]) {
        const e = this.edges[ei];
        relax(u, e.a === u ? e.b : e.a, e.len);
      }
      if (to && te) {
        if (u === te.a) relax(u, T, to.t * te.len);
        if (u === te.b) relax(u, T, (1 - to.t) * te.len);
      }
    }
    return { dist, prev };
  }
}

function isSnap(x: LngLat | Snap): x is Snap {
  return !Array.isArray(x);
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    let i = this.ids.length;
    this.ids.push(id);
    this.keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p];
      this.keys[i] = this.keys[p];
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    const n = this.ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && this.keys[r] < this.keys[l] ? r : l;
        if (this.keys[c] >= lastKey) break;
        this.ids[i] = this.ids[c];
        this.keys[i] = this.keys[c];
        i = c;
      }
      this.ids[i] = lastId;
      this.keys[i] = lastKey;
    }
    return top;
  }
}
