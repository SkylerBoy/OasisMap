import type { ParkData, Poi } from './data';
import { poiIcon } from './data';
import type { LngLat } from './geo';
import type { PathGraph, Snap } from './graph';
import { currentLang, formatDistance, pick, t } from './i18n';
import { planDay, type Plan, type PlanItem } from './planner';
import { poiIconSvg } from './poi-icons';
import { setReminder } from './reminders';
import { parkMinutes, parkWeekday, toMinutes } from './status';

export interface PlannerContext {
  data: ParkData;
  graph: PathGraph;
  snaps: Map<string, Snap>;
  /** Where the visitor is, if known and on the park paths. */
  here: () => Snap | null;
  openPoi: (p: Poi) => void;
  showRoute: (coords: LngLat[]) => void;
  toast: (msg: string) => void;
}

const SELECTABLE = ['animal', 'show', 'experience', 'botanic'] as const;
const STAY = { animal: 10, botanic: 10, show: 30, experience: 30 } as const; // experiences: 20 min + queue
const LUNCH_MIN = 45;
const LUNCH: [number, number] = [toMinutes('12:30'), toMinutes('14:45')];
const KEY = 'oasis.plan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, '0')}`;

export function startPlanner(ctx: PlannerContext) {
  const { data } = ctx;
  const byId = new Map(data.pois.map((p) => [p.id, p]));
  const choices = data.pois.filter((p) => (SELECTABLE as readonly string[]).includes(p.category) && !p.minor);
  const restaurants = data.pois.filter((p) => p.category === 'food' && p.hours && !p.id.startsWith('snack'));

  let saved: { sel: string[]; lunch: boolean } = { sel: [], lunch: true };
  try {
    saved = { ...saved, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    /* defaults */
  }
  const selected = new Set(saved.sel.filter((id) => byId.has(id)));
  let plan: Plan | null = null;

  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ sel: [...selected], lunch: $<HTMLInputElement>('plan-lunch').checked }));
    } catch {
      /* private mode */
    }
  };

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
        li.innerHTML = `<label class="plan-choice"><input type="checkbox"><span class="plan-icon cat-${p.category}">${icon}</span><span class="plan-name"></span><small></small></label>`;
        const cb = li.querySelector('input')!;
        cb.checked = selected.has(p.id);
        cb.addEventListener('change', () => {
          cb.checked ? selected.add(p.id) : selected.delete(p.id);
          persist();
          updateCount();
        });
        li.querySelector('.plan-name')!.textContent = pick(p.name);
        li.querySelector('small')!.textContent = p.schedule ?? '';
        ul.appendChild(li);
      }
      box.appendChild(group);
    }
    updateCount();
  }

  function updateCount() {
    $('plan-make').textContent = t('plan.make', { n: selected.size });
    $<HTMLButtonElement>('plan-make').disabled = selected.size === 0;
  }

  // --- plan -------------------------------------------------------------------------
  function items(): PlanItem[] {
    const today = parkWeekday();
    const out: PlanItem[] = [];
    for (const id of selected) {
      const p = byId.get(id)!;
      const cat = p.category as keyof typeof STAY;
      if (p.times?.length && (!p.days || p.days.includes(today)) && p.timesKind !== 'train' && cat === 'show') {
        out.push({ id, kind: 'show', dur: STAY.show, sessions: p.times.map(toMinutes), locs: [id] });
      } else if (p.hours) {
        out.push({ id, kind: 'window', dur: STAY[cat] ?? 20, window: [toMinutes(p.hours[0]), toMinutes(p.hours[1])], locs: [id] });
      } else out.push({ id, kind: 'visit', dur: STAY[cat] ?? 10, locs: [id] });
    }
    if ($<HTMLInputElement>('plan-lunch').checked && restaurants.length) {
      // lunch at whichever restaurant fits best; the window is lunch time within its hours
      const locs = restaurants.map((r) => r.id);
      const open = Math.max(LUNCH[0], ...restaurants.map((r) => toMinutes(r.hours![0])).filter((x) => x <= LUNCH[0]));
      out.push({ id: 'lunch', kind: 'window', dur: LUNCH_MIN, window: [open, LUNCH[1]], locs });
    }
    return out;
  }

  function makePlan() {
    const here = ctx.here();
    hereSnap = here;
    trees.clear();
    const start = toMinutes($<HTMLInputElement>('plan-start').value || '9:00');
    const end = toMinutes($<HTMLInputElement>('plan-end').value || '18:00');
    plan = planDay({
      items: items(),
      walk: walkMin,
      startLoc: here ? 'here' : 'entrada',
      startTime: start,
      endTime: end,
    });
    renderPlan();
    show('result');
  }

  function renderPlan() {
    if (!plan) return;
    const steps = plan.steps;
    const metres = steps.reduce((a, s) => a + s.walk, 0) * 60 * data.config.walkingSpeed;
    $('plan-summary').textContent = steps.length
      ? t('plan.summary', { n: steps.length, d: formatDistance(metres), t: hhmm(steps[steps.length - 1].end) })
      : t('plan.empty');
    const ol = $('plan-steps');
    ol.innerHTML = '';
    for (const s of steps) {
      const p = byId.get(s.loc)!;
      if (s.walk > 0) {
        const w = document.createElement('li');
        w.className = 'plan-walk';
        w.textContent = t('plan.walk', { n: s.walk });
        ol.appendChild(w);
      }
      const li = document.createElement('li');
      li.className = `plan-step kind-${s.item.kind}`;
      const icon = p.art ? `<img src="${import.meta.env.BASE_URL}${p.art}" alt="">` : poiIconSvg(poiIcon(p), 22);
      li.innerHTML = `<button type="button"><span class="plan-time">${hhmm(s.start)}</span><span class="plan-icon cat-${p.category}">${icon}</span><span class="plan-text"><b></b><small></small></span></button>`;
      li.querySelector('b')!.textContent = s.item.id === 'lunch' ? t('plan.lunch', { name: pick(p.name) }) : pick(p.name);
      li.querySelector('small')!.textContent =
        s.item.kind === 'show'
          ? t('plan.showAt', { t: hhmm(s.start), a: hhmm(s.arrive) })
          : t('plan.stay', { n: s.end - s.start });
      li.querySelector('button')!.addEventListener('click', () => {
        close();
        ctx.openPoi(p);
      });
      ol.appendChild(li);
    }
    const sk = $('plan-skipped');
    sk.hidden = plan.skipped.length === 0;
    sk.textContent = plan.skipped.length
      ? t('plan.skipped', { list: new Intl.ListFormat(currentLang()).format(plan.skipped.map((i) => (i.id === 'lunch' ? t('plan.lunchShort') : pick(byId.get(i.id)!.name)))) })
      : '';
    $('plan-remind').hidden = !steps.some((s) => s.item.kind === 'show');
  }

  function routeCoords(): LngLat[] {
    if (!plan) return [];
    const coords: LngLat[] = [];
    let from: Snap | null = hereSnap ?? ctx.snaps.get('entrada') ?? null;
    for (const s of plan.steps) {
      const to = ctx.snaps.get(s.loc)!;
      const r = from ? ctx.graph.route(from, to) : null;
      if (r) coords.push(...r.coords);
      from = to;
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

  function open() {
    const now = parkMinutes();
    const start = now >= toMinutes('9:00') && now < toMinutes('16:30') ? Math.ceil(now / 5) * 5 : toMinutes('9:00');
    $<HTMLInputElement>('plan-start').value = hhmm(start).padStart(5, '0');
    if (!$<HTMLInputElement>('plan-end').value) $<HTMLInputElement>('plan-end').value = '18:00';
    $<HTMLInputElement>('plan-lunch').checked = saved.lunch;
    renderChoices();
    show(plan ? 'result' : 'choose');
    $('planner').hidden = false;
    document.body.classList.add('sheet-open');
  }

  function close() {
    $('planner').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  $('plan-open').addEventListener('click', open);
  $('plan-close').addEventListener('click', close);
  $('plan-make').addEventListener('click', makePlan);
  $('plan-edit').addEventListener('click', () => show('choose'));
  $('plan-lunch').addEventListener('change', persist);
  $('plan-map').addEventListener('click', () => {
    ctx.showRoute(routeCoords());
    close();
  });
  $('plan-remind').addEventListener('click', () => {
    if (!plan) return;
    for (const s of plan.steps) if (s.item.kind === 'show') setReminder(s.item.id, hhmm(s.start));
    ctx.toast(t('remind.added'));
  });
}
