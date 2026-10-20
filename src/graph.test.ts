import { describe, expect, it } from 'vitest';
import { LocalProjection, bearing, distance, pointAlong, type LngLat, type XY } from './geo';
import { PathGraph } from './graph';
import { guide } from './nav';

const proj = new LocalProjection([-14.159, 28.186]);
const ll = (x: number, y: number): LngLat => proj.toLngLat([x, y] as XY);

describe('geo', () => {
  it('measures distance and bearing', () => {
    expect(distance(ll(0, 0), ll(100, 0))).toBeCloseTo(100, 0);
    expect(bearing(ll(0, 0), ll(0, 50))).toBeCloseTo(0, 0);
    expect(bearing(ll(0, 0), ll(50, 0))).toBeCloseTo(90, 0);
    expect(distance(pointAlong([ll(0, 0), ll(100, 0)], 25), ll(25, 0))).toBeLessThan(0.1);
  });
});

/*
 *   C(0,100) ---- D(100,100)
 *     |              |
 *   A(0,0) ------ B(100,0) ---- E(300,0)
 * A straight path A→E plus a detour via C and D.
 */
function sampleGraph() {
  return PathGraph.fromLines([
    [ll(0, 0), ll(100, 0), ll(300, 0)],
    [ll(0, 0), ll(0, 100), ll(100, 100), ll(100.5, 0.5)], // slightly off B: merged
  ]);
}

describe('PathGraph', () => {
  it('merges nearby vertices into one node', () => {
    const g = sampleGraph();
    expect(g.nodes.length).toBe(5);
    expect(g.edges.length).toBe(5);
  });

  it('finds the shortest route along the paths', () => {
    const g = sampleGraph();
    const r = g.route(ll(0, 50), ll(200, 0))!;
    // From the middle of A–C: down to A (50) then east to x=200 (200).
    expect(r.length).toBeCloseTo(250, 0);
    expect(distance(r.coords[1], ll(0, 0))).toBeLessThan(0.5);
  });

  it('routes along a single edge when start and end share it', () => {
    const g = sampleGraph();
    const r = g.route(ll(150, 5), ll(250, -5))!;
    expect(r.length).toBeCloseTo(100, 0);
    expect(r.from.dist).toBeCloseTo(5, 0);
  });

  it('joins T-junctions where a line ends on another segment', () => {
    const g = PathGraph.fromLines([
      [ll(0, 0), ll(200, 0)],
      [ll(100, 80), ll(100, 0.8)],
    ]);
    const r = g.route(ll(100, 80), ll(200, 0))!;
    // 79.2 m down to the junction node at (100, 0.8) + ~100 m east.
    expect(r.length).toBeGreaterThan(178);
    expect(r.length).toBeLessThan(181);
  });

  it('computes distances to many targets with one search', () => {
    const g = sampleGraph();
    const from = g.snap(ll(0, 50));
    const dist = g.distancesFrom(from);
    expect(g.distanceTo(dist, from, g.snap(ll(200, 0)))).toBeCloseTo(250, 0);
    expect(g.distanceTo(dist, from, g.snap(ll(0, 60)))).toBeCloseTo(10, 0);
  });
});

describe('guide', () => {
  it('points along the path, not straight at the destination', () => {
    const g = sampleGraph();
    // Start on A–C going to D: the path goes north first, D is north-east.
    const user = ll(0, 50);
    const r = g.route(user, ll(100, 100))!;
    const gd = guide(user, r);
    expect(gd.bearing).toBeCloseTo(0, 0);
    expect(gd.offPath).toBe(false);
    expect(gd.arrived).toBe(false);
  });

  it('announces the turn at the next junction', () => {
    const g = sampleGraph();
    const user = ll(100, 70); // on D–B, heading south to B then east
    const gd = guide(user, g.route(user, ll(250, 0))!, { turnHorizon: 100 });
    expect(gd.turn?.direction).toBe('left');
    expect(gd.turn?.distance).toBeCloseTo(70, 0);
  });

  it('sends the user back to the path when far away', () => {
    const g = sampleGraph();
    const user = ll(200, 60);
    const gd = guide(user, g.route(user, ll(300, 0))!);
    expect(gd.offPath).toBe(true);
    expect(gd.bearing).toBeCloseTo(180, 0);
  });

  it('detects arrival', () => {
    const g = sampleGraph();
    const user = ll(295, 0);
    expect(guide(user, g.route(user, ll(300, 0))!).arrived).toBe(true);
  });
});
