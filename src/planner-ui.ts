import type { ParkData, Poi } from './data';
import { poiIcon } from './data';
import { distance, type LngLat } from './geo';
import type { PathGraph, Snap } from './graph';
import { currentLang, formatDistance, pick, t } from './i18n';
import { ecotourTravel, type TrainStop } from './ecotour-travel';
import { insertBest, planDay, scheduleOrder, type Plan, type PlanItem, type Ride, type Travel } from './planner';
import { poiIconSvg } from './poi-icons';
import { parkDate, setReminder } from './reminders';
import { parkMinutes, parkWeekday, toMinutes } from './status';
import { pickOption, pickTime } from './time-picker';
import { decodePlan, encodePlan } from './plan-link';
import { loadPlan, SHORT_CODE, storePlan } from './plan-share';
import { buildIcs, type CalEvent } from './calendar';

export interface PlannerContext {
  data: ParkData;
  graph: PathGraph;
  snaps: Map<string, Snap>;
  /** Where the visitor is, if known and on the park paths. */
  here: () => Snap | null;
  openPoi: (p: Poi) => void;
  /** Draw the plan on the map (stop numbers by point id, and its route), or clear it. */
  /** focus: also open the map full screen on the plan (only when the visitor asks for it). */
  showPlan: (stops: Map<string, string> | null, coords: LngLat[] | null, focus?: boolean) => void;
  /** Start the arrow navigation to a point. */
  navigate: (p: Poi) => void;
  /** Point the arrow navigation is going to now, if any. */
  navTarget: () => string | null;
  toast: (msg: string, action?: () => void, ms?: number) => void;
  /** Median minutes visitors really spend at a point, when known. */
  minutesAt?: (poiId: string) => number | undefined;
}

export interface PlannerApi {
  /** Texts again after a language change. */
  refresh: () => void;
  /** Navigation reached a point. */
  arrivedAt: (poiId: string) => void;
  /** New position: arriving at the next stop marks it as done. */
  onFix: (coord: LngLat) => void;
  /** The visitor stopped the navigation by hand. */
  navStopped: () => void;
}

const LATE = 10; // minutes behind before offering to reorganise
const ARRIVED_M = 20;

const SELECTABLE = ['animal', 'show', 'experience', 'botanic'] as const;
const STAY = { animal: 6, botanic: 10, show: 30, experience: 30 } as const; // experiences: 20 min + queue
const LUNCH_MIN = 45;
const LUNCH: [number, number] = [toMinutes('12:30'), toMinutes('14:45')];
const KEY = 'oasis.plan';

/** One-tap plans: what to see and how. Edit the lists freely (point ids). */
const PRESETS: {
  id: string;
  icon: string;
  hours?: number;
  pace: number;
  lunch: boolean;
  breaks: number;
  train: boolean;
  stops: string[];
}[] = [
  {
    id: 'musts',
    icon: '⭐',
    hours: 3,
    pace: 100,
    lunch: false,
    breaks: 0,
    train: false,
    stops: ['jirafas', 'elefantes', 'hipopotamo', 'tunel-lemures', 'cocodrilo-nilo', 'flamencos', 'capibara', 'nutria', 'fenec', 'sea-lion-live', 'birds-live'],
  },
  {
    id: 'kids',
    icon: '👨‍👩‍👧',
    pace: 135,
    lunch: true,
    breaks: 90,
    train: true,
    stops: [
      'jirafas', 'elefantes', 'hipopotamo', 'tunel-lemures', 'flamencos', 'capibara', 'nutria', 'fenec', 'canguro-pelicano',
      'puercoespin', 'tortuga-aldabra', 'mono-arana', 'sabana-splash', 'sea-lion-live', 'birds-live', 'fauna-live',
    ],
  },
  { id: 'shows', icon: '🎓', pace: 100, lunch: true, breaks: 0, train: false, stops: ['sea-lion-live', 'fauna-live', 'birds-live', 'aligator'] },
  {
    id: 'quick',
    icon: '⚡',
    hours: 2,
    pace: 75,
    lunch: false,
    breaks: 0,
    train: false,
    stops: ['jirafas', 'elefantes', 'hipopotamo', 'tunel-lemures', 'flamencos', 'capibara', 'nutria', 'cocodrilo-nilo', 'sea-lion-live'],
  },
];
const OPEN = '9:00';
const CLOSE = '18:00';
const LAST_ARRIVAL = '16:30';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, '0')}`;

export function startPlanner(ctx: PlannerContext): PlannerApi {
  const { data } = ctx;
  const byId = new Map(data.pois.map((p) => [p.id, p]));
  const choices = data.pois.filter((p) => (SELECTABLE as readonly string[]).includes(p.category) && !p.minor);
  const restaurants = data.pois.filter((p) => p.category === 'food' && p.hours && !p.id.startsWith('snack'));

  /** A plan as kept on the phone, so it is there when the visitor comes back. */
  interface SavedPlan {
    date: string;
    start: string;
    end: string;
    steps: {
      id: string;
      kind: PlanItem['kind'];
      dur: number;
      loc: string;
      walk: number;
      trip?: number;
      ride?: Ride;
      arrive: number;
      start: number;
      end: number;
    }[];
    skipped: { id: string; kind: PlanItem['kind'] }[];
    /** Shown on the map. */
    onMap?: boolean;
    /** The visitor is following it (bar at the bottom). */
    following?: boolean;
    /** Ids of the stops already done. */
    done?: string[];
  }
  interface Prefs {
    /** interest: 2 high, 1 normal, 0.5 low */
    i: number;
    /** time at this stop, % of the usual */
    p: number;
  }
  let saved: {
    sel: string[];
    lunch: boolean;
    plan?: SavedPlan;
    pace?: number;
    breaks?: { every: number; dur: number };
    train?: boolean;
    offline?: boolean;
    prefs?: Record<string, Prefs>;
  } = { sel: [], lunch: true };
  try {
    saved = { ...saved, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    /* defaults */
  }
  const selected = new Set(saved.sel.filter((id) => byId.has(id)));
  /** Visit pace, % of the usual time at each animal (50–200). */
  let pace = saved.pace ?? 100;
  let breaks = saved.breaks ?? { every: 120, dur: 15 };
  const prefs: Record<string, Prefs> = saved.prefs ?? {};
  const restSpots = data.pois.filter((p) => p.category === 'food' && p.hours);
  /** Use the Ecotour train when it saves walking. */
  let useTrain = saved.train ?? true;
  /** Share long, self-contained links instead of short ones kept on the server. */
  let offlineLinks = saved.offline ?? false;
  const trainStops: TrainStop[] = data.pois
    .filter((p) => /^ecotour-\d$/.test(p.id) && p.times?.length)
    .map((p) => ({ id: p.id, n: Number(p.id.slice(-1)), times: p.times!.map(toMinutes) }));
  /** Door-to-door travel for the planner (a fresh one each time: "here" moves). */
  const travelFn = (): Travel | undefined =>
    useTrain && trainStops.length
      ? // relaxed visitors accept a longer way round to ride instead of walk
        ecotourTravel(walkMin, trainStops, { extra: pace >= 120 ? 15 : pace <= 85 ? 3 : 8 })
      : undefined;
  let plan: Plan | null = null;
  /** Days from today (0 = today) and the weekday of the chosen day. */
  let dayOffset = 0;
  const weekdayOf = (offset: number) => (parkWeekday() + offset) % 7;

  const dateOf = (offset: number) => parkDate(new Date(Date.now() + offset * 86_400_000));
  const daysFromToday = (date: string) => Math.round((Date.parse(date) - Date.parse(parkDate())) / 86_400_000);
  let savedPlan: SavedPlan | undefined;
  /** Following the plan during the visit. */
  let guide = { onMap: false, following: false, done: new Set<string>() };

  const persist = () => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          sel: [...selected],
          lunch: $<HTMLInputElement>('plan-lunch').checked,
          plan: plan ? savedPlan : undefined,
          pace,
          breaks,
          prefs,
          train: useTrain,
          offline: offlineLinks,
        }),
      );
    } catch {
      /* private mode */
    }
  };

  /** Bring back the saved plan, unless its day is over. */
  function restore() {
    const sp = saved.plan;
    if (!sp || daysFromToday(sp.date) < 0 || sp.steps.some((x) => !byId.has(x.loc))) return;
    savedPlan = sp;
    dayOffset = daysFromToday(sp.date);
    guide = { onMap: !!sp.onMap, following: !!sp.following && dayOffset === 0, done: new Set(sp.done ?? []) };
    plan = {
      steps: sp.steps.map((x) => ({ ...x, item: { id: x.id, kind: x.kind, dur: x.dur, locs: [x.loc] } })),
      skipped: sp.skipped.map((x) => ({ id: x.id, kind: x.kind, dur: 0, locs: [] })),
      walkTotal: sp.steps.reduce((a, x) => a + x.walk, 0),
    };
  }

  /** The red button: "Plan your visit", or your plan and what comes next. */
  function updateCta() {
    const title = $('plan-open').querySelector('b')!;
    const sub = $('plan-open').querySelector('small')!;
    if (!plan || !savedPlan) {
      title.textContent = t('plan.title');
      sub.textContent = t('plan.cta');
      return;
    }
    title.textContent = t('plan.yours');
    const d = daysFromToday(savedPlan.date);
    if (d > 0) {
      const day = d === 1 ? t('plan.tomorrow') : new Intl.DateTimeFormat(currentLang(), { weekday: 'long', day: 'numeric' }).format(new Date(`${savedPlan.date}T12:00:00`));
      sub.textContent = t('plan.forDay', { day, n: plan.steps.length });
      return;
    }
    const now = parkMinutes();
    const next = plan.steps.find((x) => x.end > now);
    sub.textContent = next
      ? t('plan.next', { t: hhmm(next.start), name: nameOf(next.item.id, next.loc) })
      : t('plan.done');
  }

  // --- walking minutes between points (one shortest-path tree per origin, cached) ---
  const trees = new Map<string, { from: Snap; dist: Float64Array }>();
  let hereSnap: Snap | null = null;
  const snapOf = (id: string) => (id === 'here' ? hereSnap! : ctx.snaps.get(id)!);
  const walkMin = (a: string, b: string) => {
    if (a === b) return 0;
    let tree = trees.get(a);
    if (!tree) {
      const from = snapOf(a);
      tree = { from, dist: ctx.graph.distancesFrom(from) };
      trees.set(a, tree);
    }
    const to = snapOf(b);
    const m = tree.from.dist + ctx.graph.distanceTo(tree.dist, tree.from, to) + to.dist;
    return Math.ceil(m / data.config.walkingSpeed / 60);
  };

  // --- choose ---------------------------------------------------------------------
  function renderChoices() {
    const box = $('plan-groups');
    box.innerHTML = '';
    for (const cat of SELECTABLE) {
      const pois = choices.filter((p) => p.category === cat).sort((a, b) => pick(a.name).localeCompare(pick(b.name), currentLang()));
      if (!pois.length) continue;
      const group = document.createElement('section');
      group.className = 'plan-group';
      const all = pois.every((p) => selected.has(p.id));
      group.innerHTML = `<header><h3></h3><button type="button" class="plan-all"></button></header><ul></ul>`;
      group.querySelector('h3')!.textContent = t(`cat.${cat}`);
      const allBtn = group.querySelector<HTMLButtonElement>('.plan-all')!;
      allBtn.textContent = t(all ? 'plan.none' : 'plan.all');
      allBtn.addEventListener('click', () => {
        for (const p of pois) all ? selected.delete(p.id) : selected.add(p.id);
        persist();
        renderChoices();
      });
      const ul = group.querySelector('ul')!;
      for (const p of pois) {
        const li = document.createElement('li');
        const icon = p.art
          ? `<img src="${import.meta.env.BASE_URL}${p.art}" alt="" loading="lazy">`
          : poiIconSvg(poiIcon(p), 22);
        li.innerHTML = `<label class="plan-choice" data-id="${p.id}"><input type="checkbox"><span class="plan-icon cat-${p.category}">${icon}</span><span class="plan-name"></span><small></small></label>`;
        const cb = li.querySelector('input')!;
        cb.checked = selected.has(p.id);
        cb.addEventListener('change', () => {
          cb.checked ? selected.add(p.id) : selected.delete(p.id);
          persist();
          updateCount();
          if ($<HTMLDetailsElement>('plan-adv').open) renderPrefs();
        });
        li.querySelector('.plan-name')!.textContent = pick(p.name);
        li.querySelector('small')!.textContent = p.days
          ? `${p.days.map((d) => t(`days.${d}`)).join(', ')} ${p.schedule ?? ''}`
          : (p.schedule ?? (p.category === 'animal' || p.category === 'botanic' ? t('plan.about', { n: stayAt(p.id) }) : ''));
        ul.appendChild(li);
      }
      box.appendChild(group);
    }
    updateCount();
  }

  // --- pace and advanced options -------------------------------------------------------
  const paceName = (v: number) => t(v < 90 ? 'plan.paceFast' : v <= 115 ? 'plan.paceNormal' : 'plan.paceCalm');

  function renderPace() {
    $<HTMLInputElement>('plan-pace').value = String(pace);
    $('plan-pace-v').textContent = `${paceName(pace)} · ${pace}%`;
    document.querySelectorAll<HTMLElement>('.plan-pace-presets button').forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.pace) === pace)),
    );
  }

  function setPace(v: number) {
    pace = Math.min(200, Math.max(50, Math.round(v / 5) * 5));
    renderPace();
    persist();
    // the estimated minutes next to each animal change with the pace
    document.querySelectorAll<HTMLElement>('.plan-choice').forEach((label) => {
      const id = label.dataset.id!;
      const p = byId.get(id)!;
      if ((p.category === 'animal' || p.category === 'botanic') && !p.schedule)
        label.querySelector('small')!.textContent = t('plan.about', { n: stayAt(id) });
    });
    if ($<HTMLDetailsElement>('plan-adv').open) renderPrefs();
  }

  /** Interest and own % for each chosen stop. */
  function renderPrefs() {
    const ul = $('plan-prefs');
    ul.innerHTML = '';
    const ids = [...selected].sort((a, b) => pick(byId.get(a)!.name).localeCompare(pick(byId.get(b)!.name), currentLang()));
    if (!ids.length) {
      ul.innerHTML = `<li class="plan-prefs-empty">${t('plan.prefsEmpty')}</li>`;
      return;
    }
    for (const id of ids) {
      const p = byId.get(id)!;
      const pr = prefs[id] ?? { i: 1, p: 100 };
      const timed = p.category === 'animal' || p.category === 'botanic';
      const li = document.createElement('li');
      li.className = 'plan-pref';
      li.innerHTML = `
        <div class="plan-pref-name"><b></b><small></small></div>
        <div class="plan-interest" role="group">
          ${[0.5, 1, 2].map((v) => `<button type="button" data-v="${v}" aria-pressed="${pr.i === v}">${t(`plan.interest.${v}`)}</button>`).join('')}
        </div>
        ${timed ? `<div class="plan-pct"><button type="button" data-d="-10" aria-label="−10%"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button><span></span><button type="button" data-d="10" aria-label="+10%"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>` : ''}`;
      li.querySelector('b')!.textContent = pick(p.name);
      const small = li.querySelector('small')!;
      const pct = li.querySelector<HTMLElement>('.plan-pct span');
      const paint = () => {
        const cur = prefs[id] ?? { i: 1, p: 100 };
        if (pct) pct.textContent = `${cur.p}%`;
        small.textContent = timed ? t('plan.about', { n: stayAt(id) }) : '';
      };
      paint();
      const save = (next: Prefs) => {
        if (next.i === 1 && next.p === 100) delete prefs[id];
        else prefs[id] = next;
        persist();
      };
      li.querySelectorAll<HTMLButtonElement>('.plan-interest button').forEach((b) =>
        b.addEventListener('click', () => {
          save({ ...(prefs[id] ?? { i: 1, p: 100 }), i: Number(b.dataset.v) });
          li.querySelectorAll('.plan-interest button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        }),
      );
      li.querySelectorAll<HTMLButtonElement>('.plan-pct button').forEach((b) =>
        b.addEventListener('click', () => {
          const cur = prefs[id] ?? { i: 1, p: 100 };
          save({ ...cur, p: Math.min(300, Math.max(30, cur.p + Number(b.dataset.d))) });
          paint();
        }),
      );
      ul.appendChild(li);
    }
  }

  // --- one-tap plans -------------------------------------------------------------------
  function renderPresets() {
    const box = $('plan-presets');
    box.innerHTML = '';
    for (const pr of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plan-preset';
      b.innerHTML = `<span class="plan-preset-icon" aria-hidden="true">${pr.icon}</span><b></b><small></small>`;
      b.querySelector('b')!.textContent = t(`plan.preset.${pr.id}`);
      b.querySelector('small')!.textContent = t(`plan.preset.${pr.id}.hint`);
      b.addEventListener('click', () => usePreset(pr));
      box.appendChild(b);
    }
  }

  /** Fill in the choice and settings of a ready plan, and plan it straight away. */
  function usePreset(pr: (typeof PRESETS)[number]) {
    selected.clear();
    pr.stops.filter((id) => byId.has(id)).forEach((id) => selected.add(id));
    pace = pr.pace;
    useTrain = pr.train;
    breaks = { ...breaks, every: pr.breaks };
    $<HTMLInputElement>('plan-lunch').checked = pr.lunch;
    saved.lunch = pr.lunch;
    $<HTMLInputElement>('plan-train').checked = useTrain;
    if (pr.hours) {
      const start = toMinutes($('plan-start').dataset.value || OPEN);
      setTime('plan-end', hhmm(Math.min(toMinutes(CLOSE), start + pr.hours * 60)));
    } else setTime('plan-end', CLOSE);
    renderPace();
    renderBreaks();
    renderChoices();
    persist();
    makePlan();
  }

  function updateCount() {
    $('plan-make').textContent = t('plan.make', { n: selected.size });
    $<HTMLButtonElement>('plan-make').disabled = selected.size === 0;
  }

  // --- plan -------------------------------------------------------------------------
  /** What a stop needs for planning on the chosen day (fixed sessions, opening hours or free). */
  /** Usual minutes at a point: everyone's median if known, else the default for its kind. */
  function baseMinutes(id: string): number {
    const p = byId.get(id)!;
    return ctx.minutesAt?.(id) ?? STAY[p.category as keyof typeof STAY] ?? 10;
  }

  /** Minutes planned at an animal or garden: usual time × pace × this stop's own %. */
  function stayAt(id: string): number {
    return Math.max(2, Math.round((baseMinutes(id) * pace * (prefs[id]?.p ?? 100)) / 10_000));
  }

  /** Break number k: around every `breaks.every` minutes, at a snack bar or restaurant open then. */
  function restItem(k: number): PlanItem {
    const center = toMinutes($('plan-start').dataset.value || OPEN) + k * breaks.every;
    const window: [number, number] = [center - 20, center + 20 + breaks.dur];
    const open = restSpots.filter((r) => toMinutes(r.hours![0]) <= window[0] && toMinutes(r.hours![1]) >= window[0] + breaks.dur);
    return { id: `rest-${k}`, kind: 'window', dur: breaks.dur, window, locs: (open.length ? open : restSpots).map((r) => r.id) };
  }

  function restItems(): PlanItem[] {
    if (!breaks.every || !restSpots.length) return [];
    const start = toMinutes($('plan-start').dataset.value || OPEN);
    const end = toMinutes($('plan-end').dataset.value || CLOSE);
    const lunch = $<HTMLInputElement>('plan-lunch').checked;
    const out: PlanItem[] = [];
    for (let k = 1; start + k * breaks.every + breaks.dur < end - 75; k++) { // none in the last hour
      const center = start + k * breaks.every;
      if (lunch && Math.abs(center - (LUNCH[0] + LUNCH[1]) / 2) < 75) continue; // lunch is already a break
      out.push(restItem(k));
    }
    return out;
  }

  function itemFor(id: string): PlanItem {
    if (id.startsWith('rest-')) return restItem(Number(id.slice(5)));
    if (id === 'lunch') {
      // lunch at whichever restaurant fits best; the window is lunch time within its hours
      const locs = restaurants.map((r) => r.id);
      const open = Math.max(LUNCH[0], ...restaurants.map((r) => toMinutes(r.hours![0])).filter((x) => x <= LUNCH[0]));
      return { id: 'lunch', kind: 'window', dur: LUNCH_MIN, window: [open, LUNCH[1]], locs };
    }
    const day = weekdayOf(dayOffset);
    const p = byId.get(id)!;
    const cat = p.category as keyof typeof STAY;
    // exhibitions, and weekly sessions (alligator feeding) on their day, have fixed times
    const timed = p.times?.length && p.timesKind !== 'train' && (p.days ? p.days.includes(day) : cat === 'show');
    const priority = prefs[id]?.i ?? 1;
    if (timed) return { id, kind: 'show', dur: STAY.show, sessions: p.times!.map(toMinutes), locs: [id], priority };
    if (p.hours)
      return { id, kind: 'window', dur: STAY[cat] ?? 20, window: [toMinutes(p.hours[0]), toMinutes(p.hours[1])], locs: [id], priority };
    return { id, kind: 'visit', dur: stayAt(id), locs: [id], priority };
  }

  function items(): PlanItem[] {
    const out = [...selected].map(itemFor);
    if ($<HTMLInputElement>('plan-lunch').checked && restaurants.length) out.push(itemFor('lunch'));
    return [...out, ...restItems()];
  }

  function keepPlan() {
    if (!plan) return;
    savedPlan = {
      date: dateOf(dayOffset),
      start: $('plan-start').dataset.value || OPEN,
      end: $('plan-end').dataset.value || CLOSE,
      steps: plan.steps.map((x) => ({ id: x.item.id, kind: x.item.kind, dur: x.item.dur, loc: x.loc, walk: x.walk, trip: x.trip, ride: x.ride, arrive: x.arrive, start: x.start, end: x.end })),
      skipped: plan.skipped.map((x) => ({ id: x.id, kind: x.kind })),
      onMap: guide.onMap,
      following: guide.following,
      done: [...guide.done],
    };
    persist();
    updateCta();
    refreshMap();
    renderBar();
  }

  /** Times for a plan in the visitor's own order. */
  const orderInput = () => ({
    walk: walkMin,
    travel: travelFn(),
    startLoc: hereSnap ? 'here' : 'entrada',
    startTime: toMinutes($('plan-start').dataset.value || OPEN),
    endTime: toMinutes($('plan-end').dataset.value || CLOSE),
  });
  const currentOrder = () => plan!.steps.map((st) => ({ item: { ...itemFor(st.item.id), locs: [st.loc] }, loc: st.loc }));
  const nameOf = (id: string, loc?: string) =>
    id === 'lunch'
      ? loc
        ? t('plan.lunch', { name: pick(byId.get(loc)!.name) })
        : t('plan.lunchShort')
      : id.startsWith('rest-')
        ? loc
          ? t('plan.rest', { name: pick(byId.get(loc)!.name) })
          : t('plan.restShort')
        : pick(byId.get(id)!.name);

  /** Take a stop out (swiped away); the rest keep their order. Undo from the toast. */
  function removeStop(idx: number) {
    if (!plan) return;
    const before = { plan, done: new Set(guide.done), sel: new Set(selected) };
    const s = plan.steps[idx];
    const order = currentOrder();
    order.splice(idx, 1);
    const r = scheduleOrder(order, orderInput());
    if (!('steps' in r)) return renderPlan();
    plan = { ...plan, steps: r.steps, skipped: [...plan.skipped.filter((x) => x.id !== s.item.id), { id: s.item.id, kind: s.item.kind, dur: 0, locs: [] }] };
    if (byId.has(s.item.id)) selected.delete(s.item.id);
    guide.done.delete(s.item.id);
    keepPlan();
    renderPlan();
    ctx.toast(
      t('plan.removed', { name: nameOf(s.item.id, s.loc) }),
      () => {
        plan = before.plan;
        guide.done = before.done;
        selected.clear();
        before.sel.forEach((x) => selected.add(x));
        keepPlan();
        renderPlan();
      },
      5000,
    );
  }

  /** Put a stop in where it adds the least walking, keeping the visitor's order. */
  function addStop(id: string) {
    if (!plan) return;
    const steps = insertBest(currentOrder(), itemFor(id), orderInput());
    if (!steps) {
      ctx.toast(t('plan.noFit', { name: nameOf(id) }), undefined, 4000);
      navigator.vibrate?.(60);
      return;
    }
    plan = { ...plan, steps, skipped: plan.skipped.filter((x) => x.id !== id) };
    if (id !== 'lunch') selected.add(id);
    keepPlan();
    renderPlan();
    const s = steps.find((x) => x.item.id === id)!;
    ctx.toast(t('plan.added', { name: nameOf(id, s.loc), t: hhmm(s.start) }));
  }

  let addAll = false;

  /** "Add stops": what did not fit or was taken out first, then (on demand) everything else. */
  function renderAdd() {
    if (!plan) return;
    const inPlan = new Set(plan.steps.map((s) => s.item.id));
    const skipped = plan.skipped.map((x) => x.id).filter((id) => !inPlan.has(id) && (id === 'lunch' || byId.has(id)));
    const rest = addAll
      ? [
          ...(inPlan.has('lunch') || skipped.includes('lunch') || !restaurants.length ? [] : ['lunch']),
          ...choices
            .filter((p) => !inPlan.has(p.id) && !skipped.includes(p.id))
            .sort((a, b) => pick(a.name).localeCompare(pick(b.name), currentLang()))
            .map((p) => p.id),
        ]
      : [];
    const ul = $('plan-add-list');
    ul.innerHTML = '';
    for (const id of [...skipped, ...rest]) {
      const p = id === 'lunch' ? restaurants[0] : byId.get(id)!;
      const li = document.createElement('li');
      const icon = id !== 'lunch' && p.art ? `<img src="${import.meta.env.BASE_URL}${p.art}" alt="" loading="lazy">` : poiIconSvg(poiIcon(p), 22);
      li.innerHTML = `<button type="button" class="plan-add-item"><span class="plan-icon cat-${p.category}">${icon}</span><span class="plan-text"><b></b><small></small></span><span class="plan-plus" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span></button>`;
      li.querySelector('b')!.textContent = nameOf(id);
      li.querySelector('small')!.textContent = skipped.includes(id) ? t('plan.notIn') : id === 'lunch' ? '' : (p.schedule ?? '');
      li.querySelector('button')!.addEventListener('click', () => addStop(id));
      ul.appendChild(li);
    }
    $('plan-add-more').hidden = addAll;
    $('plan-add').hidden = dayOffset < 0;
  }

  /** The visitor dragged a stop: same stops in the new order, times worked out again. */
  function reorder(from: number, to: number) {
    if (!plan || from === to) return renderPlan();
    const order = plan.steps.map((st) => ({ item: { ...itemFor(st.item.id), locs: [st.loc] }, loc: st.loc }));
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    const r = scheduleOrder(order, {
      walk: walkMin,
      travel: travelFn(),
      startLoc: hereSnap ? 'here' : 'entrada',
      startTime: toMinutes($('plan-start').dataset.value || OPEN),
      endTime: toMinutes($('plan-end').dataset.value || CLOSE),
    });
    if ('problem' in r) {
      const it = order[r.problem.index];
      const name = nameOf(it.item.id, it.loc);
      ctx.toast(t(`plan.no.${r.problem.reason}`, { name }));
      navigator.vibrate?.(60);
      return renderPlan();
    }
    plan = { ...plan, steps: r.steps, walkTotal: r.steps.reduce((a, x) => a + x.walk, 0) };
    keepPlan();
    renderPlan();
  }

  /** A break only after some 45 min of visiting since the start or the last break or lunch. */
  function dropIdleBreaks(p: Plan): Plan {
    let busy = 0;
    const keep = p.steps.filter((st) => {
      const isRest = st.item.id.startsWith('rest-') || st.item.id === 'lunch';
      if (!isRest) {
        busy += st.end - st.start + st.walk;
        return true;
      }
      const ok = st.item.id === 'lunch' || busy >= 45;
      if (ok) busy = 0;
      return ok;
    });
    if (keep.length === p.steps.length) return p;
    const r = scheduleOrder(
      keep.map((st) => ({ item: st.item, loc: st.loc })),
      { ...orderInput(), startLoc: hereSnap ? 'here' : 'entrada' },
    );
    return 'steps' in r ? { ...p, steps: r.steps } : p;
  }

  function makePlan() {
    const here = ctx.here();
    hereSnap = here;
    trees.clear();
    const start = toMinutes($('plan-start').dataset.value || '9:00');
    const end = toMinutes($('plan-end').dataset.value || '18:00');
    plan = dropIdleBreaks(
      planDay({
        items: items(),
        walk: walkMin,
        travel: travelFn(),
        startLoc: here ? 'here' : 'entrada',
        startTime: start,
        endTime: end,
      }),
    );
    guide = { onMap: guide.onMap, following: false, done: new Set() };
    keepPlan();
    renderPlan();
    show('result');
  }

  const start0 = () => toMinutes($('plan-start').dataset.value || OPEN);

  function renderPlan() {
    if (!plan) return;
    const steps = plan.steps;
    const metres = steps.reduce((a, s) => a + s.walk, 0) * 60 * data.config.walkingSpeed;
    $('plan-summary').textContent = steps.length
      ? t(steps.length === 1 ? 'plan.summary1' : 'plan.summary', { n: steps.length, d: formatDistance(metres), t: hhmm(steps[steps.length - 1].end) })
      : t('plan.empty');
    const ol = $('plan-steps');
    ol.innerHTML = '';
    let free = start0();
    for (const s of steps) {
      const p = byId.get(s.loc)!;
      // a long gap before leaving for this stop: free time
      const gap = s.arrive - (s.trip ?? s.walk) - free;
      if (gap >= 20) {
        const g = document.createElement('li');
        g.className = 'plan-free';
        g.textContent = t('plan.free', { t: hhmm(free), d: gap >= 60 ? `${Math.floor(gap / 60)} h ${gap % 60} min` : `${gap} min` });
        ol.appendChild(g);
      }
      free = s.end;
      if (s.ride) {
        const w = document.createElement('li');
        w.className = 'plan-walk plan-ride';
        w.textContent = t('plan.ride', { w: s.walk, dep: hhmm(s.ride.dep), from: s.ride.from, to: s.ride.to, arr: hhmm(s.ride.arr) });
        ol.appendChild(w);
      } else if (s.walk > 0) {
        const w = document.createElement('li');
        w.className = 'plan-walk';
        w.textContent = t('plan.walk', { n: s.walk });
        ol.appendChild(w);
      }
      const li = document.createElement('li');
      li.className = `plan-step kind-${s.item.kind}`;
      li.dataset.idx = String(steps.indexOf(s));
      const icon = p.art ? `<img src="${import.meta.env.BASE_URL}${p.art}" alt="">` : poiIconSvg(poiIcon(p), 22);
      li.innerHTML = `<span class="plan-del" aria-hidden="true">${t('plan.remove')}</span><button type="button"><span class="plan-time">${hhmm(s.start)}</span><span class="plan-icon cat-${p.category}">${icon}</span><span class="plan-text"><b></b><small></small></span></button>`;
      li.querySelector('b')!.textContent = nameOf(s.item.id, s.loc);
      li.querySelector('small')!.textContent =
        s.item.kind === 'show'
          ? t('plan.showAt', { t: hhmm(s.start), a: hhmm(s.arrive) })
          : t('plan.stay', { n: s.end - s.start });
      li.querySelector('button')!.addEventListener('click', () => {
        if (dragJustEnded) return;
        close();
        ctx.openPoi(p);
      });
      ol.appendChild(li);
    }
    renderAdd();
    const sk = $('plan-skipped');
    sk.hidden = true; // listed under "Add stops" now
    sk.textContent = plan.skipped.length
      ? t('plan.skipped', { list: new Intl.ListFormat(currentLang()).format(plan.skipped.map((i) => nameOf(i.id))) })
      : '';
    $('plan-remind').hidden = dayOffset !== 0 || !steps.some((s) => s.item.kind === 'show');
    $('plan-go').hidden = dayOffset !== 0 || !steps.length;
    if (!$('planner').hidden) prepareShortLink(); // likely to be shared: get the short link ready
    $('plan-go').textContent = t(guide.following ? 'plan.goOn' : 'plan.go');
  }

  /** The part of the Ecotour track between two stops. */
  function trackBetween(a: number, b: number): LngLat[] {
    const track = data.ecotour;
    const near = (n: number) => {
      const c = byId.get(`ecotour-${n}`)!.coord;
      let k = 0;
      track.forEach((p, i) => distance(p, c) < distance(track[k], c) && (k = i));
      return k;
    };
    if (!track.length) return [];
    const [i, j] = [near(a), near(b)];
    return track.slice(Math.min(i, j), Math.max(i, j) + 1);
  }

  function routeCoords(): LngLat[] {
    if (!plan) return [];
    const coords: LngLat[] = [];
    let from: Snap | null = hereSnap ?? ctx.snaps.get('entrada') ?? null;
    const walkTo = (to: Snap) => {
      const r = from ? ctx.graph.route(from, to) : null;
      if (r) coords.push(...r.coords);
      from = to;
    };
    for (const s of plan.steps) {
      if (s.ride) {
        // walk to the stop, the train's own track, then walk on from where you get off
        walkTo(ctx.snaps.get(`ecotour-${s.ride.from}`)!);
        coords.push(...trackBetween(s.ride.from, s.ride.to));
        from = ctx.snaps.get(`ecotour-${s.ride.to}`)!;
      }
      walkTo(ctx.snaps.get(s.loc)!);
    }
    return coords;
  }

  // --- panel ------------------------------------------------------------------------
  function show(view: 'choose' | 'result') {
    $('plan-choose').hidden = view !== 'choose';
    $('plan-result').hidden = view !== 'result';
    $('plan-make').hidden = view !== 'choose';
    $('plan-foot-result').hidden = view !== 'result';
    $('planner').scrollTop = 0;
    $('plan-body').scrollTop = 0;
  }

  /** Chips for today and the next 6 days. */
  function renderDays() {
    const box = $('plan-days');
    box.innerHTML = '';
    const fmt = new Intl.DateTimeFormat(currentLang(), { timeZone: 'Atlantic/Canary', weekday: 'short', day: 'numeric' });
    for (let k = 0; k < 7; k++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plan-day';
      b.setAttribute('aria-pressed', String(k === dayOffset));
      b.textContent = k === 0 ? t('plan.today') : k === 1 ? t('plan.tomorrow') : fmt.format(new Date(Date.now() + k * 86_400_000));
      b.addEventListener('click', () => {
        dayOffset = k;
        plan = null;
        guide = { onMap: false, following: false, done: new Set() };
        persist();
        updateCta();
        refreshMap();
        renderBar();
        renderDays();
        defaultStart();
      });
      box.appendChild(b);
    }
  }

  /** Today: from now (if the park is open); another day: from opening time. */
  function defaultStart() {
    const now = parkMinutes();
    const start =
      dayOffset === 0 && now >= toMinutes(OPEN) && now < toMinutes(LAST_ARRIVAL) ? Math.ceil(now / 5) * 5 : toMinutes(OPEN);
    setTime('plan-start', hhmm(start));
  }

  function open() {
    // after closing time, plan for tomorrow
    if (!plan) dayOffset = parkMinutes() >= toMinutes(LAST_ARRIVAL) ? 1 : 0;
    renderDays();
    if (plan && savedPlan) {
      setTime('plan-start', savedPlan.start);
      setTime('plan-end', savedPlan.end);
    } else defaultStart();
    $<HTMLInputElement>('plan-lunch').checked = saved.lunch;
    renderBreaks();
    renderPace();
    renderPresets();
    renderChoices();
    if (plan) renderPlan();
    show(plan ? 'result' : 'choose');
    $('planner').hidden = false;
    document.body.classList.add('sheet-open');
  }

  function close() {
    $('planner').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  function setTime(id: string, v: string) {
    $(id).dataset.value = v;
    $(id).querySelector('.plan-time-v')!.textContent = v;
  }
  // Arrival between opening and 16:30; leaving at least 30 min later and by closing time.
  $('plan-start').addEventListener('click', async () => {
    const v = await pickTime(t('plan.start'), $('plan-start').dataset.value ?? OPEN, { min: OPEN, max: LAST_ARRIVAL });
    if (!v) return;
    setTime('plan-start', v);
    if (toMinutes($('plan-end').dataset.value ?? CLOSE) < toMinutes(v) + 30) setTime('plan-end', hhmm(toMinutes(v) + 30));
  });
  $('plan-end').addEventListener('click', async () => {
    const min = hhmm(toMinutes($('plan-start').dataset.value ?? OPEN) + 30);
    const v = await pickTime(t('plan.end'), $('plan-end').dataset.value ?? CLOSE, { min, max: CLOSE });
    if (v) setTime('plan-end', v);
  });

  // --- reorder the plan: long press a stop, drag it, drop it --------------------------
  let drag: { li: HTMLElement; from: number; y0: number; pointer: number } | null = null;
  let pressTimer = 0;
  let pressAt: { x: number; y: number; li: HTMLElement; pointer: number } | null = null;
  let dragJustEnded = false;
  let swipe: { li: HTMLElement; btn: HTMLElement; x0: number; dx: number; pointer: number } | null = null;
  const SWIPE_REMOVE = 90;
  const list = $('plan-steps');

  list.addEventListener('pointerdown', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.plan-step');
    if (!li || drag) return;
    pressAt = { x: e.clientX, y: e.clientY, li, pointer: e.pointerId };
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      if (!pressAt) return;
      drag = { li, from: Number(li.dataset.idx), y0: pressAt.y, pointer: pressAt.pointer };
      list.classList.add('reordering');
      li.classList.add('lifted');
      navigator.vibrate?.(30);
    }, 380);
  });

  list.addEventListener('pointermove', (e) => {
    if (swipe && e.pointerId === swipe.pointer) {
      const dx = Math.min(0, e.clientX - swipe.x0);
      swipe.dx = dx;
      swipe.btn.style.transform = `translateX(${dx}px)`;
      swipe.li.classList.toggle('will-remove', dx < -SWIPE_REMOVE);
      return;
    }
    if (pressAt && !drag) {
      const dx = e.clientX - pressAt.x;
      const dy = e.clientY - pressAt.y;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3 && dx < 0) {
        // sideways: swipe to remove
        clearTimeout(pressTimer);
        const btn = pressAt.li.querySelector<HTMLElement>('button')!;
        swipe = { li: pressAt.li, btn, x0: pressAt.x, dx: 0, pointer: pressAt.pointer };
        pressAt.li.classList.add('swiping');
        pressAt = null;
        return;
      }
      if (Math.hypot(dx, dy) > 8) {
        clearTimeout(pressTimer); // it is a scroll, not a long press
        pressAt = null;
      }
    }
    if (!drag || e.pointerId !== drag.pointer) return;
    const dy = e.clientY - drag.y0;
    drag.li.style.transform = `translateY(${dy}px)`;
    // swap with the neighbour once we pass its middle
    const items = [...list.querySelectorAll<HTMLElement>('.plan-step')];
    const i = items.indexOf(drag.li);
    const r = drag.li.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const prev = items[i - 1];
    const next = items[i + 1];
    if (next && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) {
      next.after(drag.li);
      drag.y0 += next.offsetHeight + 8;
      drag.li.style.transform = `translateY(${e.clientY - drag.y0}px)`;
    } else if (prev && mid < prev.getBoundingClientRect().top + prev.offsetHeight / 2) {
      prev.before(drag.li);
      drag.y0 -= prev.offsetHeight + 8;
      drag.li.style.transform = `translateY(${e.clientY - drag.y0}px)`;
    }
  });

  // while dragging, the finger moves the stop instead of scrolling
  list.addEventListener('touchmove', (e) => drag && e.preventDefault(), { passive: false });
  list.addEventListener('contextmenu', (e) => drag && e.preventDefault());

  const drop = () => {
    clearTimeout(pressTimer);
    pressAt = null;
    if (swipe) {
      const { li, btn, dx } = swipe;
      swipe = null;
      dragJustEnded = true;
      setTimeout(() => (dragJustEnded = false), 50);
      li.classList.remove('swiping', 'will-remove');
      if (dx < -SWIPE_REMOVE) {
        btn.style.transform = 'translateX(-110%)';
        setTimeout(() => removeStop(Number(li.dataset.idx)), 160);
      } else btn.style.transform = '';
      return;
    }
    if (!drag) return;
    const { li, from } = drag;
    drag = null;
    const to = [...list.querySelectorAll<HTMLElement>('.plan-step')].indexOf(li);
    list.classList.remove('reordering');
    li.classList.remove('lifted');
    li.style.transform = '';
    dragJustEnded = true;
    setTimeout(() => (dragJustEnded = false), 50);
    reorder(from, to);
  };
  list.addEventListener('pointerup', drop);
  list.addEventListener('pointercancel', drop);

  // --- the plan on the map, and following it during the visit ------------------------
  let routeCache: { key: string; coords: LngLat[] } | null = null;

  /** Stop number per point (a point twice in the plan shows "2·5"). */
  function stopNumbers(): Map<string, string> {
    const m = new Map<string, string>();
    plan?.steps.forEach((s, i) => m.set(s.loc, m.has(s.loc) ? `${m.get(s.loc)}·${i + 1}` : String(i + 1)));
    return m;
  }

  function refreshMap() {
    const on = !!plan && plan.steps.length > 0 && guide.onMap;
    $('plan-chip').hidden = !on;
    if (!on) {
      ctx.showPlan(null, null);
      return;
    }
    const key = plan!.steps.map((s) => s.loc).join(',');
    if (routeCache?.key !== key) routeCache = { key, coords: routeCoords() };
    ctx.showPlan(stopNumbers(), routeCache.coords);
    const left = plan!.steps.filter((s) => !guide.done.has(s.item.id)).length;
    $('plan-chip-text').textContent = t('plan.chip', { n: plan!.steps.length, left });
  }

  const nextStep = () => plan?.steps.find((s) => !guide.done.has(s.item.id));
  const stepName = (s: { item: PlanItem; loc: string }) =>
    nameOf(s.item.id, s.loc);

  /** Minutes behind the plan for the next stop (negative: ahead). */
  function lateBy(s: NonNullable<ReturnType<typeof nextStep>>): number {
    const now = parkMinutes();
    const here = ctx.here();
    if (here) {
      hereSnap = here;
      trees.delete('here');
      return now + walkMin('here', s.loc) - s.arrive;
    }
    return now - (s.arrive - s.walk); // no position: compare with the time to leave
  }

  function renderBar() {
    const bar = $('plan-bar');
    const on = !!plan && guide.following && dayOffset === 0;
    bar.hidden = !on;
    document.body.classList.toggle('has-plan-bar', on);
    if (!on) return;
    const s = nextStep();
    const idx = s ? plan!.steps.indexOf(s) : -1;
    $('pb-n').textContent = s ? String(idx + 1) : '✓';
    $('pb-name').textContent = s ? `${hhmm(s.start)} · ${stepName(s)}` : t('plan.done');
    $('pb-go').hidden = !s;
    $('pb-done').hidden = !s;
    if (!s) {
      $('pb-status').textContent = '';
      $('pb-replan').hidden = true;
      bar.classList.remove('late');
      return;
    }
    const late = lateBy(s);
    const leave = s.arrive - (s.trip ?? s.walk);
    const onTrain = s.ride && parkMinutes() <= s.ride.dep;
    $('pb-status').textContent =
      late >= LATE
        ? t('pb.late', { n: late })
        : onTrain
          ? t('pb.train', { t: hhmm(s.ride!.dep), n: s.ride!.from, to: s.ride!.to })
          : parkMinutes() < leave - 1
            ? t('pb.leaveAt', { t: hhmm(leave), w: s.walk })
            : t('pb.onTime', { n: idx + 1, total: plan!.steps.length });
    $('pb-replan').hidden = late < LATE;
    bar.classList.toggle('late', late >= LATE);
    guideNav();
  }

  function markDone(id: string) {
    if (!plan || guide.done.has(id)) return;
    const s = plan.steps.find((x) => x.item.id === id)!;
    guide.done.add(id);
    keepPlan();
    const n = nextStep();
    navigator.vibrate?.(40);
    ctx.toast(
      n ? t('pb.doneNext', { name: stepName(s), next: stepName(n), t: hhmm(n.start) }) : t('plan.done'),
      n ? () => ctx.navigate(byId.get(n.loc)!) : undefined,
      5000,
    );
  }

  /** Behind time: plan the stops left again, from here and now. */
  function replan() {
    if (!plan) return;
    const done = plan.steps.filter((s) => guide.done.has(s.item.id));
    const left = plan.steps.filter((s) => !guide.done.has(s.item.id));
    const here = ctx.here();
    hereSnap = here;
    trees.clear();
    const now = Math.ceil(parkMinutes() / 5) * 5;
    const r = planDay({
      items: left.map((s) => itemFor(s.item.id)),
      walk: walkMin,
      travel: travelFn(),
      startLoc: here ? 'here' : done.length ? done[done.length - 1].loc : 'entrada',
      startTime: now,
      endTime: toMinutes(savedPlan?.end ?? CLOSE),
    });
    plan = { steps: [...done, ...r.steps], skipped: [...plan.skipped, ...r.skipped], walkTotal: 0 };
    keepPlan();
    ctx.toast(
      r.skipped.length
        ? t('pb.replannedDrop', { list: new Intl.ListFormat(currentLang()).format(r.skipped.map((i) => nameOf(i.id))) })
        : t('pb.replanned'),
      undefined,
      5000,
    );
  }

  function startGuide() {
    if (!plan) return;
    guide.following = true;
    guide.onMap = true;
    navDismissed.clear();
    keepPlan();
    close();
    guideNav(true);
  }

  // --- the arrow follows the plan -------------------------------------------------------
  /** "stop id > point" the visitor closed the navigation for: not opened again for it. */
  const navDismissed = new Set<string>();
  let autoNav: string | null = null;

  /** Where to walk now for the next stop: the train stop first if it is a train leg. */
  function navTargetFor(s: NonNullable<ReturnType<typeof nextStep>>): string {
    return s.ride && parkMinutes() <= s.ride.dep ? `ecotour-${s.ride.from}` : s.loc;
  }

  /** Following the plan: when it is time to leave, the arrow points to the next stop. */
  function guideNav(now = false) {
    if (!plan || !guide.following || dayOffset !== 0) return;
    const s = nextStep();
    if (!s) return;
    const target = navTargetFor(s);
    const key = `${s.item.id}>${target}`;
    if (ctx.navTarget() === target || navDismissed.has(key)) return;
    const leave = s.arrive - (s.trip ?? s.walk);
    if (!now && parkMinutes() < leave - 2) return; // still time at the current stop
    autoNav = key;
    ctx.navigate(byId.get(target)!);
  }

  function navStopped() {
    if (autoNav) navDismissed.add(autoNav);
    autoNav = null;
  }

  function arrivedAt(poiId: string) {
    const n = nextStep();
    if (guide.following && n && n.loc === poiId) markDone(n.item.id);
  }

  function onFix(coord: LngLat) {
    const n = nextStep();
    if (!guide.following || !n) return;
    if (distance(coord, byId.get(n.loc)!.coord) < ARRIVED_M) markDone(n.item.id);
    else guideNav();
  }

  // --- share the plan (WhatsApp or any app) and open a shared one ----------------------
  /** Compact plan for a link: day, times, settings and the stops in order. */
  interface SharedPlan {
    v: 1;
    d: string; // date
    s: string; // start
    e: string; // end
    p: number; // pace
    t: 0 | 1; // train
    l: 0 | 1; // lunch
    b: [number, number]; // breaks every, length
    x: (string | [string, string])[]; // stop id, or [id, point] for lunch / breaks
  }
  const b64 = {
    enc: (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s: string) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))),
  };

  /** The plan packed for links: each stop is its 2-character code. */
  function packed(): string {
    return encodePlan(
      {
        date: savedPlan?.date ?? dateOf(dayOffset),
        start: toMinutes(savedPlan?.start ?? OPEN),
        end: toMinutes(savedPlan?.end ?? CLOSE),
        pace,
        train: useTrain,
        lunch: $<HTMLInputElement>('plan-lunch').checked,
        every: breaks.every,
        length: breaks.dur,
        stops: plan!.steps.map((st) => ({ id: st.item.id, loc: st.loc })),
      },
      (id) => byId.get(id)?.code ?? '',
    );
  }

  const baseUrl = () => {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  };

  /** Short link ready for the current plan (made in the background so sharing is instant). */
  let short: { packed: string; url: string } | null = null;
  let shortening: Promise<void> | null = null;

  function prepareShortLink() {
    if (!plan?.steps.length || offlineLinks) return;
    const p = packed();
    if (short?.packed === p) return;
    const expires = dateOf(Math.max(0, daysFromToday(savedPlan?.date ?? dateOf(0))) + 1);
    shortening = storePlan(data.config.stats, p, expires).then((code) => {
      if (code && packed() === p) short = { packed: p, url: `${baseUrl()}?plan=${code}` };
    });
  }

  /** Short ?plan=CODE link if it could be stored, else the long one that works offline. */
  async function shareLink(): Promise<string> {
    const p = packed();
    if (offlineLinks) return `${baseUrl()}?p=${p}`;
    if (short?.packed !== p) {
      prepareShortLink();
      await Promise.race([shortening, new Promise((r) => setTimeout(r, 2500))]);
    }
    return short?.packed === p ? short.url : `${baseUrl()}?p=${p}`;
  }

  function shareText(): string {
    const d = daysFromToday(savedPlan?.date ?? dateOf(0));
    const day =
      d <= 0
        ? t('plan.today')
        : d === 1
          ? t('plan.tomorrow')
          : new Intl.DateTimeFormat(currentLang(), { weekday: 'long', day: 'numeric' }).format(new Date(`${savedPlan!.date}T12:00:00`));
    const lines = plan!.steps.slice(0, 25).map((st) => `${hhmm(st.start)} ${st.ride ? '🚂 ' : ''}${nameOf(st.item.id, st.loc)}`);
    if (plan!.steps.length > 25) lines.push(t('plan.shareMore', { n: plan!.steps.length - 25 }));
    return `${t('plan.shareTitle', { day })}\n\n${lines.join('\n')}\n\n${t('plan.shareOpen')}`;
  }

  async function sharePlan() {
    if (!plan?.steps.length) return;
    const url = await shareLink();
    const text = shareText();
    // The phone's share sheet (WhatsApp, Telegram, mail…) if there is one, else WhatsApp directly.
    if (navigator.share) {
      try {
        await navigator.share({ title: t('plan.yours'), text, url });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener');
  }

  /** Opened from a shared link: offer to use that plan. */
  async function offerShared() {
    const q = new URLSearchParams(location.search);
    let sp: SharedPlan | null = null;
    let packedPlan = q.get('p');
    const shortCode = q.get('plan');
    if (shortCode && SHORT_CODE.test(shortCode)) {
      packedPlan = await loadPlan(data.config.stats, shortCode);
      if (!packedPlan) ctx.toast(t('plan.linkGone'), undefined, 5000);
    }
    try {
      if (packedPlan) {
        // packed plan (from ?p= or fetched for ?plan=CODE)
        const byCode = new Map(data.pois.filter((p) => p.code).map((p) => [p.code!, p.id]));
        const d = decodePlan(packedPlan, byCode);
        if (d)
          sp = {
            v: 1,
            d: d.date,
            s: hhmm(d.start),
            e: hhmm(d.end),
            p: d.pace,
            t: d.train ? 1 : 0,
            l: d.lunch ? 1 : 0,
            b: [d.every, d.length],
            x: d.stops.map((x) => [x.id, x.loc] as [string, string]),
          };
      } else if (q.get('plan') && !SHORT_CODE.test(q.get('plan')!)) {
        // first, longer links
        const v1 = b64.dec(q.get('plan')!) as SharedPlan;
        if (v1.v === 1 && Array.isArray(v1.x)) sp = v1;
      }
    } catch {
      sp = null;
    }
    if (!q.get('p') && !q.get('plan')) return;
    // the link is used once; a reload should not ask again
    const clean = new URL(location.href);
    clean.searchParams.delete('p');
    clean.searchParams.delete('plan');
    history.replaceState(null, '', clean);
    if (!sp) return;
    const stops = sp.x.map((x) => (Array.isArray(x) ? { id: x[0], loc: x[1] } : { id: x, loc: x }));
    const usable = stops.filter((x) => byId.has(x.loc) && (x.id === 'lunch' || x.id.startsWith('rest-') || byId.has(x.id)));
    if (!usable.length) return;
    const d = Math.max(0, daysFromToday(sp.d));
    const dayName =
      d === 0 ? t('plan.today') : d === 1 ? t('plan.tomorrow') : new Intl.DateTimeFormat(currentLang(), { weekday: 'long', day: 'numeric' }).format(new Date(`${sp.d}T12:00:00`));
    $('plan-import-text').textContent = t('plan.importAsk', { n: usable.filter((x) => !x.id.startsWith('rest-')).length, day: dayName });
    $('plan-import').hidden = false;
    $('plan-import-no').onclick = () => ($('plan-import').hidden = true);
    $('plan-import-yes').onclick = () => {
      $('plan-import').hidden = true;
      dayOffset = d;
      pace = sp.p;
      useTrain = !!sp.t;
      breaks = { every: sp.b[0], dur: sp.b[1] };
      $<HTMLInputElement>('plan-lunch').checked = !!sp.l;
      saved.lunch = !!sp.l;
      $<HTMLInputElement>('plan-train').checked = useTrain;
      setTime('plan-start', sp.s);
      setTime('plan-end', sp.e);
      selected.clear();
      usable.forEach((x) => byId.has(x.id) && byId.get(x.id)!.category !== 'food' && selected.add(x.id));
      hereSnap = null;
      trees.clear();
      // same order as the sender; times worked out again here (if they no longer fit, plan afresh)
      const r = scheduleOrder(
        usable.map((x) => ({ item: { ...itemFor(x.id), locs: [x.loc] }, loc: x.loc })),
        orderInput(),
      );
      plan = 'steps' in r ? { steps: r.steps, skipped: [], walkTotal: 0 } : planDay({ ...orderInput(), items: items() });
      guide = { onMap: false, following: false, done: new Set() };
      keepPlan();
      open();
      ctx.toast(t('plan.imported'));
    };
  }

  $('plan-share').addEventListener('click', () => void sharePlan());
  $('plan-cal').addEventListener('click', exportCalendar);

  /** The plan as calendar events: alarms when it is time to leave for fixed-time stops and trains. */
  function exportCalendar() {
    if (!plan?.steps.length) return;
    const date = savedPlan?.date ?? dateOf(dayOffset);
    const events: CalEvent[] = [];
    plan.steps.forEach((st, i) => {
      const poi = byId.get(st.loc)!;
      const name = nameOf(st.item.id, st.loc);
      const leave = st.trip ?? st.walk;
      if (st.ride) {
        events.push({
          uid: `${date}-${i}-train@oasismap`,
          title: `🚂 ${t('cal.train', { from: st.ride.from, to: st.ride.to })}`,
          date,
          start: st.ride.dep,
          end: st.ride.arr,
          alarm: Math.max(2, st.ride.dep - (st.arrive - leave)), // time to walk to the stop
          geo: byId.get(`ecotour-${st.ride.from}`)?.coord,
        });
      }
      const fixed = st.item.kind !== 'visit';
      events.push({
        uid: `${date}-${i}-${st.item.id}@oasismap`,
        title: `${st.item.kind === 'show' ? '🎓 ' : st.item.id === 'lunch' ? '🍽️ ' : st.item.id.startsWith('rest-') ? '☕ ' : '🦒 '}${name}`,
        description: st.item.kind === 'show' ? t('plan.showAt', { t: hhmm(st.start), a: hhmm(st.arrive) }) : t('plan.stay', { n: st.end - st.start }),
        date,
        start: st.start,
        end: st.end,
        // be told when to leave: walk (or train) plus the margin already in the plan
        alarm: fixed && !st.ride ? st.start - st.arrive + leave : undefined,
        geo: poi.coord,
      });
    });
    const ics = buildIcs(events, t('plan.yours'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = `oasis-wildlife-${date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    ctx.toast(t('plan.calendarDone'), undefined, 6000);
  }

  restore();
  void offerShared();
  updateCta();
  refreshMap();
  renderBar();
  window.setInterval(() => {
    updateCta();
    renderBar();
  }, 30_000);

  $('plan-open').addEventListener('click', open);
  $('plan-close').addEventListener('click', close);
  $('plan-make').addEventListener('click', makePlan);
  $('plan-edit').addEventListener('click', () => show('choose'));
  $('plan-lunch').addEventListener('change', persist);
  $('plan-map').addEventListener('click', () => {
    guide.onMap = true;
    keepPlan();
    close();
    ctx.showPlan(stopNumbers(), routeCoords(), true);
  });
  $('plan-go').addEventListener('click', startGuide);
  $('plan-chip-open').addEventListener('click', open);
  $('plan-chip-x').addEventListener('click', () => {
    guide.onMap = false;
    keepPlan();
  });
  $('pb-open').addEventListener('click', open);
  $('pb-go').addEventListener('click', () => {
    const n = nextStep();
    if (!n) return;
    // taking the train: first to the stop where you get on
    const target = navTargetFor(n);
    navDismissed.delete(`${n.item.id}>${target}`);
    autoNav = `${n.item.id}>${target}`;
    ctx.navigate(byId.get(target)!);
  });
  $('pb-done').addEventListener('click', () => {
    const n = nextStep();
    if (n) markDone(n.item.id);
  });
  $('pb-replan').addEventListener('click', replan);
  $('pb-x').addEventListener('click', () => {
    guide.following = false;
    keepPlan();
  });
  $<HTMLInputElement>('plan-offline').checked = offlineLinks;
  $('plan-offline').addEventListener('change', () => {
    offlineLinks = $<HTMLInputElement>('plan-offline').checked;
    persist();
  });
  $<HTMLInputElement>('plan-train').checked = useTrain;
  $('plan-train').addEventListener('change', () => {
    useTrain = $<HTMLInputElement>('plan-train').checked;
    persist();
  });
  $('plan-pace').addEventListener('input', (e) => setPace(Number((e.target as HTMLInputElement).value)));
  document.querySelectorAll<HTMLElement>('.plan-pace-presets button').forEach((b) =>
    b.addEventListener('click', () => setPace(Number(b.dataset.pace))),
  );
  /** How many breaks a visit would get with breaks every `every` minutes. */
  const breaksIn = (every: number) => {
    const span = toMinutes($('plan-end').dataset.value || CLOSE) - toMinutes($('plan-start').dataset.value || OPEN);
    return Math.max(0, Math.floor((span - 75) / every) - ($<HTMLInputElement>('plan-lunch').checked ? 1 : 0));
  };
  const everyOptions = () => [
    { value: 0, label: t('plan.breakNone'), hint: t('plan.breakNoneHint') },
    ...[90, 120, 150, 180].map((v) => ({
      value: v,
      label: v % 60 ? `${Math.floor(v / 60)} h ${v % 60}` : `${v / 60} h`,
      hint: breaksIn(v) === 1 ? t('plan.breakCount1') : t('plan.breakCount', { n: breaksIn(v) }),
    })),
  ];
  const durOptions = () =>
    [10, 15, 20, 30].map((v) => ({ value: v, label: `${v} min`, hint: t(`plan.breakDur.${v}`) }));
  function renderBreaks() {
    const every = $('plan-break-every');
    every.dataset.value = String(breaks.every);
    every.querySelector('span')!.textContent = everyOptions().find((o) => o.value === breaks.every)?.label ?? '';
    const dur = $<HTMLButtonElement>('plan-break-dur');
    dur.dataset.value = String(breaks.dur);
    dur.querySelector('span')!.textContent = `${breaks.dur} min`;
    dur.disabled = !breaks.every;
  }
  $('plan-break-every').addEventListener('click', async () => {
    const v = await pickOption(t('plan.breaksEvery'), everyOptions(), breaks.every);
    if (v === null) return;
    breaks = { ...breaks, every: v };
    renderBreaks();
    persist();
  });
  $('plan-break-dur').addEventListener('click', async () => {
    const v = await pickOption(t('plan.breaksLong'), durOptions(), breaks.dur);
    if (v === null) return;
    breaks = { ...breaks, dur: v };
    renderBreaks();
    persist();
  });
  $('plan-adv').addEventListener('toggle', () => $<HTMLDetailsElement>('plan-adv').open && renderPrefs());
  $('plan-add-more').addEventListener('click', () => {
    addAll = true;
    renderAdd();
  });
  $('plan-remind').addEventListener('click', () => {
    if (!plan) return;
    for (const s of plan.steps) if (s.item.kind === 'show') setReminder(s.item.id, hhmm(s.start));
    ctx.toast(t('remind.added'));
  });
  return {
    refresh: () => {
      updateCta();
      refreshMap();
      renderBar();
    },
    arrivedAt,
    onFix,
    navStopped,
  };
}
