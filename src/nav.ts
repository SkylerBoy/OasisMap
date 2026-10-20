import { angleDiff, bearing, distance, pointAlong, type LngLat } from './geo';
import type { Route } from './graph';

export type TurnDirection = 'left' | 'right' | 'straight';

export interface Guidance {
  arrived: boolean;
  /** User is far from any path: first walk to the nearest one. */
  offPath: boolean;
  /** Point the arrow aims at (a little ahead along the route). */
  target: LngLat;
  /** Bearing from the user to `target`, degrees from north. */
  bearing: number;
  /** Metres left to walk. */
  remaining: number;
  /** Next junction on the route, if close. */
  turn: { direction: TurnDirection; distance: number } | null;
}

export interface GuidanceOptions {
  lookahead?: number;
  arriveRadius?: number;
  offPathDistance?: number;
  turnHorizon?: number;
}

/**
 * Turns a route that starts at the user's position into arrow guidance.
 * The arrow aims a few metres ahead along the path, so it follows curves and
 * junctions instead of pointing straight at the destination.
 */
export function guide(user: LngLat, route: Route, opts: GuidanceOptions = {}): Guidance {
  const lookahead = opts.lookahead ?? 12;
  const arriveRadius = opts.arriveRadius ?? 12;
  const offPathDistance = opts.offPathDistance ?? 15;
  const turnHorizon = opts.turnHorizon ?? 40;

  const offLeg = route.from.dist;
  const remaining = route.length + offLeg;
  const dest = route.coords[route.coords.length - 1];
  const arrived = remaining <= arriveRadius || distance(user, dest) <= arriveRadius;

  if (offLeg > offPathDistance) {
    const target = route.from.point;
    return { arrived, offPath: true, target, bearing: bearing(user, target), remaining, turn: null };
  }

  const target = pointAlong(route.coords, Math.min(lookahead, route.length));
  const b = distance(user, target) < 0.5 ? bearing(route.coords[0], dest) : bearing(user, target);
  return { arrived, offPath: false, target, bearing: b, remaining, turn: nextTurn(route, turnHorizon) };
}

function nextTurn(route: Route, horizon: number): Guidance['turn'] {
  const { coords, junctions } = route;
  let along = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    along += distance(coords[i - 1], coords[i]);
    if (along > horizon) return null;
    if (!junctions[i]) continue;
    const before = pointAlong(coords, Math.max(0, along - 8));
    const after = pointAlong(coords, along + 8);
    const delta = angleDiff(bearing(before, coords[i]), bearing(coords[i], after));
    const direction: TurnDirection = Math.abs(delta) < 30 ? 'straight' : delta < 0 ? 'left' : 'right';
    return { direction, distance: along };
  }
  return null;
}
