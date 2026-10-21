/**
 * Day planner: fits the chosen animals, exhibitions and experiences into the
 * visit, respecting their times, with walking time between them.
 *
 * Exhibitions have fixed sessions; we try every combination of sessions (there
 * are only a few) and, for each, insert the other stops one by one where they
 * add the least walking without breaking any time. The best plan keeps the most
 * exhibitions, then timed stops (experiences, lunch), then animals, then walks the least.
 */

export type PlanKind = 'visit' | 'show' | 'window';

export interface PlanItem {
  /** Point id, or a special id like "lunch". */
  id: string;
  kind: PlanKind;
  /** Minutes spent there. */
  dur: number;
  /** show: session start times (minutes since midnight). */
  sessions?: number[];
  /** window: must start and end within these minutes (opening hours). */
  window?: [number, number];
  /** Where it can happen: point ids (several for "lunch at any restaurant"). */
  locs: string[];
}

export interface PlanStep {
  item: PlanItem;
  loc: string;
  /** Minutes walking from the previous stop. */
  walk: number;
  arrive: number;
  start: number;
  end: number;
}

export interface Plan {
  steps: PlanStep[];
  skipped: PlanItem[];
  walkTotal: number;
}

export interface PlanInput {
  items: PlanItem[];
  /** Walking minutes between two point ids. */
  walk: (a: string, b: string) => number;
  startLoc: string;
  startTime: number;
  endTime: number;
  /** Be there this many minutes before an exhibition starts. */
  showMargin?: number;
}

interface Slot {
  item: PlanItem;
  loc: string;
  /** For shows: the chosen session. */
  session?: number;
}

function simulate(seq: Slot[], inp: PlanInput, margin: number): PlanStep[] | null {
  let t = inp.startTime;
  let at = inp.startLoc;
  const steps: PlanStep[] = [];
  for (const s of seq) {
    const walk = inp.walk(at, s.loc);
    if (!isFinite(walk)) return null;
    let arrive = t + walk;
    let start = arrive;
    if (s.session !== undefined) {
      if (arrive > s.session - margin) return null;
      arrive = s.session - margin; // no need to wait there longer than the margin
      start = s.session;
    } else if (s.item.window) {
      start = Math.max(arrive, s.item.window[0]);
      if (start + s.item.dur > s.item.window[1]) return null;
      arrive = start; // leave so as to arrive when it opens
    }
    const end = start + s.item.dur;
    if (end > inp.endTime) return null;
    steps.push({ item: s.item, loc: s.loc, walk, arrive, start, end });
    t = end;
    at = s.loc;
  }
  return steps;
}

const walked = (steps: PlanStep[]) => steps.reduce((a, s) => a + s.walk, 0);

/** Every way to pick one session per exhibition (exhibitions without a usable session are left out). */
function sessionCombos(shows: PlanItem[], inp: PlanInput, margin: number): Slot[][] {
  let combos: Slot[][] = [[]];
  for (const sh of shows) {
    const ok = (sh.sessions ?? []).filter((x) => x - margin >= inp.startTime && x + sh.dur <= inp.endTime);
    const next: Slot[][] = [];
    for (const c of combos) {
      for (const x of ok) next.push([...c, { item: sh, loc: sh.locs[0], session: x }]);
      if (!ok.length) next.push(c); // no session left today: plan without it
    }
    combos = next;
    if (combos.length > 400) combos = combos.slice(-400);
  }
  return combos.map((c) => c.sort((a, b) => a.session! - b.session!));
}

export function planDay(inp: PlanInput): Plan {
  const margin = inp.showMargin ?? 10;
  const shows = inp.items.filter((i) => i.kind === 'show');
  // tighter stops first: experiences and meals have opening hours, animals do not
  const flexible = inp.items
    .filter((i) => i.kind !== 'show')
    .sort((a, b) => (a.window ? 0 : 1) - (b.window ? 0 : 1));

  let best: { steps: PlanStep[]; count: number; walk: number } | null = null;
  for (const base of sessionCombos(shows, inp, margin)) {
    let seq = base;
    let steps = simulate(seq, inp, margin);
    if (!steps) {
      // these sessions are too close together: drop the later ones that cannot be reached
      seq = [];
      for (const s of base) if (simulate([...seq, s], inp, margin)) seq.push(s);
      steps = simulate(seq, inp, margin)!;
    }
    const left = [...flexible];
    // Cheapest insertion, one stop at a time: try positions by the detour they add,
    // and keep the first that still respects every time.
    for (;;) {
      let pick: { seq: Slot[]; steps: PlanStep[]; idx: number; cost: number } | null = null;
      const windowsLeft = left.some((i) => i.window);
      for (let k = 0; k < left.length; k++) {
        const item = left[k];
        if (windowsLeft && !item.window) continue; // stops with opening hours go in first
        const options: { pos: number; loc: string; delta: number }[] = [];
        for (const loc of item.locs) {
          for (let pos = 0; pos <= seq.length; pos++) {
            const prev = pos === 0 ? inp.startLoc : seq[pos - 1].loc;
            const next = pos < seq.length ? seq[pos].loc : null;
            const delta = inp.walk(prev, loc) + (next ? inp.walk(loc, next) - inp.walk(prev, next) : 0);
            options.push({ pos, loc, delta });
          }
        }
        options.sort((x, y) => x.delta - y.delta);
        for (const o of options) {
          if (pick && o.delta >= pick.cost) break;
          const trial = [...seq.slice(0, o.pos), { item, loc: o.loc }, ...seq.slice(o.pos)];
          const st = simulate(trial, inp, margin);
          if (st) {
            pick = { seq: trial, steps: st, idx: k, cost: o.delta };
            break;
          }
        }
      }
      if (!pick) {
        if (windowsLeft) {
          // no room for the remaining timed stops: drop them and go on with the rest
          for (let k = left.length - 1; k >= 0; k--) if (left[k].window) left.splice(k, 1);
          continue;
        }
        break;
      }
      seq = pick.seq;
      steps = pick.steps;
      left.splice(pick.idx, 1);
    }
    // exhibitions matter most, then stops with opening hours, then the rest; then less walking
    const count = steps.reduce((a, s) => a + (s.item.kind === 'show' ? 10000 : s.item.kind === 'window' ? 100 : 1), 0);
    const w = walked(steps);
    if (!best || count > best.count || (count === best.count && w < best.walk)) best = { steps, count, walk: w };
  }
  const steps = best?.steps ?? [];
  const used = new Set(steps.map((s) => s.item));
  return { steps, skipped: inp.items.filter((i) => !used.has(i)), walkTotal: best?.walk ?? 0 };
}

export type OrderProblem = { index: number; reason: 'session' | 'closed' | 'end' };

/**
 * Times for stops in a given order (the visitor reordered the plan). Each
 * exhibition takes the first session that can still be reached.
 */
export function scheduleOrder(
  order: { item: PlanItem; loc: string }[],
  inp: Omit<PlanInput, 'items'>,
): { steps: PlanStep[] } | { problem: OrderProblem } {
  const margin = inp.showMargin ?? 10;
  let t = inp.startTime;
  let at = inp.startLoc;
  const steps: PlanStep[] = [];
  for (let i = 0; i < order.length; i++) {
    const { item, loc } = order[i];
    const walk = inp.walk(at, loc);
    let arrive = t + walk;
    let start = arrive;
    if (item.kind === 'show' && item.sessions?.length) {
      const session = item.sessions.find((x) => arrive <= x - margin);
      if (session === undefined) return { problem: { index: i, reason: 'session' } };
      arrive = session - margin;
      start = session;
    } else if (item.window) {
      start = Math.max(arrive, item.window[0]);
      if (start + item.dur > item.window[1]) return { problem: { index: i, reason: 'closed' } };
      arrive = start;
    }
    const end = start + item.dur;
    if (end > inp.endTime) return { problem: { index: i, reason: 'end' } };
    steps.push({ item, loc, walk, arrive, start, end });
    t = end;
    at = loc;
  }
  return { steps };
}
