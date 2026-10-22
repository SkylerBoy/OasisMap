import type { Ride, Travel } from './planner';

/** Ecotour stop for planning: its point id, number and departure times (minutes since midnight). */
export interface TrainStop {
  id: string;
  n: number;
  times: number[];
}

const BETWEEN_STOPS = 5; // minutes from one stop to the next
const BOARD = 1; // be at the stop this long before the train leaves

/**
 * Door-to-door travel that takes the Ecotour (stops 0 → 5) when it spares the
 * legs: at least `walkSaved` minutes less walking, and at most `extra` minutes
 * longer than walking all the way (in this park the train is slower than
 * walking, so it is about effort, not speed). Which trains could ever help
 * between two points is worked out once per pair; then only those are checked.
 */
export function ecotourTravel(
  walk: (a: string, b: string) => number,
  stops: TrainStop[],
  { walkSaved = 5, extra = 8 } = {},
): Travel {
  const sorted = [...stops].sort((x, y) => x.n - y.n);
  const options = new Map<string, { i: TrainStop; j: TrainStop; wi: number; wj: number }[]>();

  const candidates = (a: string, b: string, direct: number) => {
    const key = `${a}>${b}`;
    let list = options.get(key);
    if (!list) {
      list = [];
      for (const i of sorted)
        for (const j of sorted) {
          if (j.n <= i.n) continue;
          const wi = walk(a, i.id);
          const wj = walk(j.id, b);
          const best = wi + BOARD + (j.n - i.n) * BETWEEN_STOPS + wj; // with no wait at all
          if (wi + wj <= direct - walkSaved && best <= direct + extra) list.push({ i, j, wi, wj });
        }
      options.set(key, list);
    }
    return list;
  };

  return (a, b, t) => {
    const direct = walk(a, b);
    let best: { minutes: number; walk: number; ride?: Ride } = { minutes: direct, walk: direct };
    if (a === b) return best;
    // a minute walking counts double: what matters is sparing the legs without losing much time
    let bestCost = 2 * direct;
    for (const { i, j, wi, wj } of candidates(a, b, direct)) {
      const dep = i.times.find((x) => x >= t + wi + BOARD);
      if (dep === undefined) continue;
      const arr = dep + (j.n - i.n) * BETWEEN_STOPS;
      if (!j.times.includes(arr)) continue; // this run does not reach that stop (the last one ends early)
      const minutes = arr + wj - t;
      if (minutes > direct + extra) continue; // waiting too long for the train
      const cost = minutes + wi + wj;
      if (cost < bestCost) {
        bestCost = cost;
        best = { minutes, walk: wi + wj, ride: { from: i.n, to: j.n, dep, arr } };
      }
    }
    return best;
  };
}
