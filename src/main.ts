import './styles.css';
import { CATEGORIES, CATEGORY_ICON, loadPark, poiIcon, type Category, type ParkData, type Poi } from './data';
import { distance, type LngLat } from './geo';
import { PathGraph, type Snap } from './graph';
import { LANGUAGES, currentLang, detectLang, formatDistance, pick, setLang, t } from './i18n';
import { Compass, LocationTracker, type Fix } from './location';
import { HAS_TILES, ParkMap } from './map';
import { guide, type Guidance } from './nav';
import { unlockDevMode } from './dev-pin';
import { startDevTools } from './dev-tools';
import { ICONS } from './icons';
import { poiIconSvg } from './poi-icons';
import { ecotourRun, poiStatus, type Status } from './status';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Further than this from every path = not inside the park. */
const OUTSIDE_PARK_M = 150;

interface State {
  fix: Fix | null;
  heading: number | null;
  selected: Poi | null;
  navTo: Poi | null;
  guidance: Guidance | null;
  category: Category | 'all';
  query: string;
  expanded: boolean;
  follow: boolean;
  /** Walking distance per POI id from the user. */
  walk: Map<string, number>;
  walkFrom: LngLat | null;
}

const state: State = {
  fix: null,
  heading: null,
  selected: null,
  navTo: null,
  guidance: null,
  category: 'all',
  query: '',
  expanded: false,
  follow: true,
  walk: new Map(),
  walkFrom: null,
};

let data: ParkData;
let graph: PathGraph;
let poiSnaps: Map<string, Snap>;
let pmap: ParkMap;
let tracker: LocationTracker;
let compass: Compass;
const params = new URLSearchParams(location.search);
/** Staff tools (?mode=dev), unlocked with a PIN. */
let captureMode = params.get('mode') === 'dev';

async function init() {
  await setLang(detectLang());
  data = await loadPark();
  graph = PathGraph.fromLines(data.paths);
  poiSnaps = new Map(data.pois.map((p) => [p.id, graph.snap(p.coord)]));

  pmap = new ParkMap($('map'), data, {
    onPoiClick: (poi) => openSheet(poi),
    onMapClick: (coord) => {
      if (canSimulate()) tracker.simulate(coord);
      else closeSheet();
    },
    onBaseFallback: () => toast(t('satFallback')),
  });

  compass = new Compass((h) => {
    state.heading = h;
    renderHeading();
  });
  tracker = new LocationTracker(onFix, (err) => {
    if (state.fix?.simulated) return;
    const msg = err === 'denied' ? t('locationDenied') : t('locationUnavailable');
    showStatus(captureMode ? msg : `${msg} ${t('simHint')}`);
  });

  buildLanguageSelect();
  buildChips();
  bindUi();
  applyI18n();
  renderList();
  // Opening badges and "starts in N min" change with the clock.
  window.setInterval(() => {
    renderList();
    renderSheet();
  }, 60_000);

  if (captureMode) {
    captureMode = await unlockDevMode();
    if (captureMode) {
      document.body.classList.add('dev-mode');
      startDevTools(pmap, tracker, data.pois, (poi, coord) => {
        poi.coord = coord;
        poiSnaps.set(poi.id, graph.snap(coord));
        updateWalkDistances();
        renderList();
      });
    }
    else {
      // Cancelled: carry on as a visitor and drop the parameter from the URL.
      params.delete('mode');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
    }
  }
  showStatus(t('locating'));
  tracker.start();
  registerServiceWorker();
}

// --- location ----------------------------------------------------------------

function isInsidePark(fix: Fix): boolean {
  return graph.snap(fix.coord).dist <= OUTSIDE_PARK_M;
}

function canSimulate(): boolean {
  if (captureMode) return false;
  const fix = state.fix;
  return params.has('sim') || !fix || fix.simulated || !isInsidePark(fix);
}

function onFix(fix: Fix) {
  state.fix = fix;
  hideStatus();
  pmap.setUser(fix, currentHeading());

  if (!state.walkFrom || distance(state.walkFrom, fix.coord) > 5) {
    updateWalkDistances();
    renderList();
    if (state.selected) renderSheet();
  }
  if (state.navTo) updateNavigation();
}

function currentHeading(): number | null {
  return state.heading ?? state.fix?.course ?? null;
}

function updateWalkDistances() {
  if (!state.fix) return;
  const from = graph.snap(state.fix.coord);
  const dist = graph.distancesFrom(from);
  state.walk = new Map(data.pois.map((p) => [p.id, from.dist + graph.distanceTo(dist, from, poiSnaps.get(p.id)!)]));
  state.walkFrom = state.fix.coord;
}

function walkText(poiId: string): string {
  const d = state.walk.get(poiId);
  if (d == null || !isFinite(d)) return '';
  const minutes = Math.max(1, Math.round(d / data.config.walkingSpeed / 60));
  return t('walk', { d: formatDistance(d), t: t('min', { n: minutes }) });
}

// --- navigation --------------------------------------------------------------

async function startNavigation(poi: Poi) {
  // Must run inside the tap: iOS only grants compass access from a gesture.
  const ok = await compass.start();
  $('hud-compass').hidden = true;
  if (!ok && Compass.needsPermission) $('hud-compass').hidden = false;

  state.navTo = poi;
  setFollow(true);
  closeSheet();
  setExpanded(true);
  $('nav-hud').hidden = false;
  pmap.highlight(poi.id);
  updateNavigation(true);
}

function stopNavigation() {
  state.navTo = null;
  state.guidance = null;
  $('nav-hud').hidden = true;
  pmap.setRoute(null);
  pmap.highlight(null);
}

function updateNavigation(fit = false) {
  const poi = state.navTo;
  if (!poi) return;
  const fix = state.fix;
  if (!fix) {
    $('hud-instruction').textContent = t('locating');
    $('hud-meta').textContent = pick(poi.name);
    return;
  }
  const route = graph.route(fix.coord, poiSnaps.get(poi.id)!);
  if (!route) {
    toast(t('noRoute'));
    stopNavigation();
    return;
  }
  const g = guide(fix.coord, route);
  state.guidance = g;
  pmap.setRoute(g.offPath ? [fix.coord, ...route.coords] : route.coords);

  if (fit) // Leave room for the HUD at the top and the buttons on the right.
    pmap.fitTo([fix.coord, ...route.coords, poi.coord], { top: 170, bottom: 40, left: 40, right: 70 });
  else if (state.follow) pmap.centerOn(fix.coord);

  let instruction: string;
  if (g.arrived) instruction = t('arrived', { name: pick(poi.name) });
  else if (g.offPath) instruction = t('toPath', { d: formatDistance(route.from.dist) });
  else if (g.turn && g.turn.direction !== 'straight') instruction = t(`turn.${g.turn.direction}`, { d: formatDistance(g.turn.distance) });
  else if (g.turn) instruction = t('turn.straight', { d: formatDistance(g.turn.distance) });
  else instruction = t('follow');

  $('hud-instruction').textContent = instruction;
  const minutes = Math.max(1, Math.round(g.remaining / data.config.walkingSpeed / 60));
  $('hud-meta').textContent = g.arrived
    ? ''
    : `${pick(poi.name)} · ${t('remaining', { d: formatDistance(g.remaining) })} · ${t('min', { n: minutes })}`;
  $('nav-hud').classList.toggle('arrived', g.arrived);
  $('hud-stop').textContent = g.arrived ? t('close') : t('stop');
  renderHeading();
}

/** Rotate the HUD arrow and the user's view cone. Cheap: runs on every compass event. */
function renderHeading() {
  const heading = currentHeading();
  pmap.setUser(state.fix, heading);
  const g = state.guidance;
  const arrow = $('hud-arrow');
  if (!g || g.arrived) {
    arrow.style.visibility = g?.arrived ? 'hidden' : 'visible';
    return;
  }
  arrow.style.visibility = 'visible';
  // With a compass the arrow is relative to where the phone points; without
  // one it is relative to the (north-up) map.
  const rot = heading == null ? g.bearing : g.bearing - heading;
  arrow.style.transform = `rotate(${rot}deg)`;
  arrow.classList.toggle('no-compass', heading == null);
  arrow.setAttribute('aria-label', heading == null ? t('noCompass') : '');
}

// --- UI ----------------------------------------------------------------------

/** Official park map PDFs exist in es, en and de; ca and eu fall back to Spanish, the rest to English. */
const MAP_PDF = (lang: string) => {
  const l = ['es', 'en', 'de'].includes(lang) ? lang : ['ca', 'eu'].includes(lang) ? 'es' : 'en';
  return `https://wildapp.oasiswildlifefuerteventura.com/img/mapas/assets/mapa_${l}.pdf`;
};

function updatePdfLink() {
  $<HTMLAnchorElement>('pdf-link').href = MAP_PDF(currentLang());
}

function buildLanguageSelect() {
  const sel = $<HTMLSelectElement>('lang-select');
  sel.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
  sel.value = currentLang();
  const code = () => {
    $('lang-code').textContent = currentLang().toUpperCase();
    updatePdfLink();
  };
  code();
  sel.addEventListener('change', async () => {
    await setLang(sel.value);
    code();
    applyI18n();
    buildChips();
    renderList();
    pmap.relabel();
    if (state.selected) renderSheet();
    if (state.navTo) updateNavigation();
  });
}

function buildChips() {
  const el = $('chips');
  el.innerHTML = '';
  for (const c of ['all', ...CATEGORIES] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (state.category === c ? ' active' : '');
    b.innerHTML = c === 'all' ? '' : poiIconSvg(CATEGORY_ICON[c], 18);
    b.append(c === 'all' ? t('all') : t(`cat.${c}`));
    b.addEventListener('click', () => {
      state.category = c;
      buildChips();
      renderList();
    });
    el.appendChild(b);
  }
}

function visiblePois(): Poi[] {
  const q = normalize(state.query);
  return data.pois.filter(
    (p) =>
      (state.category === 'all' || p.category === state.category) &&
      (!q || normalize(pick(p.name)).includes(q) || (p.number && p.number === q)),
  );
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function renderList() {
  const pois = visiblePois();
  pmap.filter(state.category === 'all' && !state.query ? null : new Set(pois.map((p) => p.id)));
  pois.sort((a, b) => {
    const da = state.walk.get(a.id) ?? Infinity;
    const db = state.walk.get(b.id) ?? Infinity;
    return da - db || pick(a.name).localeCompare(pick(b.name), currentLang());
  });
  const ul = $('poi-list');
  ul.innerHTML = '';
  if (pois.length === 0) {
    ul.innerHTML = `<li class="empty">${t('noResults')}</li>`;
    return;
  }
  for (const p of pois) {
    const li = document.createElement('li');
    li.innerHTML = `
      <button type="button" class="poi-row">
        ${
          p.art
            ? `<span class="row-icon art cat-${p.category}"><img src="${import.meta.env.BASE_URL}${p.art}" alt="" loading="lazy"></span>`
            : `<span class="row-icon cat-${p.category}">${poiIconSvg(poiIcon(p), 24)}</span>`
        }
        <span class="row-main">
          <span class="row-name"></span>
          <span class="row-sub"></span>
        </span>
        ${p.number ? `<span class="row-num">${p.number}</span>` : ''}
      </button>`;
    li.querySelector('.row-name')!.textContent = pick(p.name);
    const sub = li.querySelector('.row-sub')!;
    sub.textContent = [t(`cat.${p.category}`), walkText(p.id)].filter(Boolean).join(' · ');
    const st = poiStatus(p);
    if (st) sub.prepend(statusBadge(st));
    li.querySelector('button')!.addEventListener('click', () => openSheet(p));
    ul.appendChild(li);
  }
}

/** Show or hide the "meet our animals" part of the sheet. */
function setSheetExpanded(on: boolean) {
  const sheet = $('sheet');
  sheet.classList.toggle('expanded', on);
  $('sheet-more').hidden = !on;
  $('more-hint').hidden = on || !state.selected || !data.animals[state.selected.id];
  if (on) requestAnimationFrame(() => $('sheet-more').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  else sheet.scrollTo({ top: 0, behavior: 'smooth' });
}

const SEX = { m: '♂', f: '♀' } as const;
const IUCN_SCALE = ['LC', 'NT', 'VU', 'EN', 'CR'] as const;

function yearsText(n: number): string {
  return n < 1 ? t('more.baby') : n === 1 ? t('more.year1') : t('more.years', { n });
}

/** Species status and one card per animal, picked with the name tabs. */
function renderAnimals(p: Poi) {
  const info = data.animals[p.id];
  const hint = $('more-hint');
  hint.hidden = !info || $('sheet').classList.contains('expanded');
  if (!info) {
    $('sheet-more').hidden = true;
    return;
  }
  const names = info.individuals.map((a) => a.name);
  const list = new Intl.ListFormat(currentLang(), { type: 'conjunction' }).format(names);
  $('more-hint-text').textContent = t('more.hint', { names: list });

  const iucn = $('iucn');
  iucn.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'iucn-label';
  label.innerHTML = `<span>${t('more.status')}</span> <b></b>`;
  label.querySelector('b')!.textContent = [pick(info.species), t(`iucn.${info.iucn}`)].filter(Boolean).join(' · ');
  iucn.appendChild(label);
  if (info.iucn !== 'DOM') {
    const scale = document.createElement('div');
    scale.className = 'iucn-scale';
    for (const c of IUCN_SCALE) {
      const s = document.createElement('span');
      s.className = `iucn-${c}${c === info.iucn ? ' on' : ''}`;
      s.textContent = c;
      s.title = t(`iucn.${c}`);
      scale.appendChild(s);
    }
    iucn.appendChild(scale);
  }

  const tabs = $('ind-tabs');
  tabs.innerHTML = '';
  tabs.hidden = info.individuals.length < 2;
  const year = new Date().getFullYear();
  const show = (i: number) => {
    animalIdx = i;
    tabs.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    const a = info.individuals[i];
    const card = $('ind-card');
    card.innerHTML = `
      <h4><span class="ind-name"></span> <span class="sex sex-${a.sex}" title="${t(`sex.${a.sex}`)}">${SEX[a.sex]}</span></h4>
      <dl>
        <div><dt>${t('more.age')}</dt><dd>${yearsText(year - a.born)}</dd></div>
        <div><dt>${t('more.with')}</dt><dd>${t('more.since', { y: a.arrived, n: yearsText(year - a.arrived) })}</dd></div>
        <div><dt>${t('more.origin')}</dt><dd class="ind-origin"></dd></div>
      </dl>
      <p class="ind-story"></p>`;
    card.querySelector('.ind-name')!.textContent = a.name;
    card.querySelector('.ind-origin')!.textContent = pick(a.origin);
    card.querySelector('.ind-story')!.textContent = pick(a.story);
  };
  info.individuals.forEach((a, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'tab';
    b.className = 'ind-tab';
    b.innerHTML = `<span></span> <span class="sex sex-${a.sex}">${SEX[a.sex]}</span>`;
    b.querySelector('span')!.textContent = a.name;
    b.addEventListener('click', () => show(i));
    tabs.appendChild(b);
  });
  show(Math.min(animalIdx, info.individuals.length - 1));
}

function statusBadge(st: Status): HTMLElement {
  const b = document.createElement('span');
  b.className = `status-badge tone-${st.tone}`;
  b.textContent = st.text;
  return b;
}

/** Ecotour stop: when the next train reaches this and the following stops. */
function renderEcotourRun(p: Poi) {
  const box = $('sheet-ecotour');
  const m = /^ecotour-(\d)$/.exec(p.id);
  const run = m ? ecotourRun(data.pois, Number(m[1])) : [];
  box.hidden = run.length === 0;
  if (!run.length) return;
  const here = Number(m![1]);
  $('eco-stops').innerHTML = '';
  for (const r of run) {
    const n = Number(r.stop.id.slice(-1));
    const li = document.createElement('li');
    li.className = r.min < -1 ? 'past' : n === here ? 'here' : ''; // dim only stops the train has left
    const name = pick(r.stop.name).replace(/^.*?:\s*/, '');
    li.innerHTML = `<span class="eco-n">${n}</span><span class="eco-name"></span><span class="eco-at"></span>`;
    li.querySelector('.eco-name')!.textContent = name;
    li.querySelector('.eco-at')!.textContent =
      r.min > 0 ? `${r.at} · ${t('min', { n: r.min })}` : r.min > -2 ? t('status.trainHere') : r.at;
    $('eco-stops').appendChild(li);
  }
}

let animalIdx = 0; // animal picked in the sheet, kept across the once-a-minute refresh

function openSheet(poi: Poi) {
  state.selected = poi;
  animalIdx = 0;
  const sheet = $('sheet');
  sheet.classList.remove('expanded', 'hint-bounce');
  $('sheet-more').hidden = true;
  sheet.scrollTop = 0;
  renderSheet();
  // A little bounce says there is more to see when swiping up.
  if (data.animals[poi.id]) {
    void sheet.offsetWidth;
    sheet.classList.add('hint-bounce');
  }
  pmap.highlight(poi.id);
  pmap.centerOn(poi.coord);
  $('sheet').classList.add('open');
  $('sheet').setAttribute('aria-hidden', 'false');
  $('sheet-backdrop').hidden = false;
}

function renderSheet() {
  const p = state.selected;
  if (!p) return;
  const hero = $('sheet-hero');
  hero.className = `sheet-hero cat-${p.category}${p.image ? ' has-photo' : ''}`;
  hero.style.backgroundImage = p.image ? `url("${import.meta.env.BASE_URL}${p.image}")` : '';
  $('sheet-art').innerHTML = p.image ? '' : poiIconSvg(poiIcon(p), 120);
  $('sheet-num').hidden = !p.number;
  $('sheet-num').textContent = p.number ?? '';
  $('sheet-title').textContent = pick(p.name);
  $('sheet-sub').textContent = [t(`cat.${p.category}`), walkText(p.id)].filter(Boolean).join(' · ');
  $('sheet-desc').textContent = pick(p.description);
  $('sheet-schedule').hidden = !p.schedule;
  const st = poiStatus(p);
  const badge = $('sheet-status');
  badge.hidden = !st;
  if (st) {
    badge.className = `status-badge tone-${st.tone}`;
    badge.textContent = st.text;
  }
  renderEcotourRun(p);
  renderAnimals(p);
  $('sheet-times').textContent = [p.days?.map((d) => t(`days.${d}`)).join(', '), p.schedule].filter(Boolean).join(' ');
}

function closeSheet() {
  if (!state.selected) return;
  state.selected = null;
  $('sheet').classList.remove('open');
  $('sheet').setAttribute('aria-hidden', 'true');
  $('sheet-backdrop').hidden = true;
  if (!state.navTo) pmap.highlight(null);
}

function setExpanded(expanded: boolean) {
  state.expanded = expanded;
  document.body.classList.toggle('map-expanded', expanded);
  $('btn-expand').innerHTML = expanded ? ICONS.collapse : ICONS.expand;
  $('btn-expand').title = t(expanded ? 'map.collapse' : 'map.expand');
  // Wait for the CSS transition before resizing the WebGL canvas.
  setTimeout(() => pmap.resize(), 260);
}

const LAYERS = ['osm', 'pnoa', 'overlay'] as const;
let layerIdx = 0;

function cycleLayer() {
  const options = LAYERS.filter((l) => l !== 'overlay' || pmap.hasOverlay);
  layerIdx = (layerIdx + 1) % options.length;
  const l = options[layerIdx];
  pmap.setOverlayVisible(l === 'overlay');
  if (l !== 'overlay') pmap.setBase(l);
  toast(t(l === 'osm' ? 'layer.map' : l === 'pnoa' ? 'layer.satellite' : 'layer.illustrated'));
}

function setFollow(follow: boolean) {
  state.follow = follow;
}

function bindUi() {
  $('btn-expand').innerHTML = ICONS.expand;
  $('btn-locate').innerHTML = ICONS.locate;
  $('btn-layer').innerHTML = ICONS.layers;
  $('btn-expand').addEventListener('click', () => setExpanded(!state.expanded));
  $('btn-locate').addEventListener('click', () => {
    setFollow(true);
    if (state.fix) pmap.centerOn(state.fix.coord, 18);
    else toast(t('locating'));
  });
  $('btn-layer').addEventListener('click', cycleLayer);
  $('btn-layer').hidden = !HAS_TILES && !pmap.hasOverlay;
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-backdrop').addEventListener('click', closeSheet);
  $('sheet-go').addEventListener('click', () => state.selected && startNavigation(state.selected));
  $('hud-stop').addEventListener('click', stopNavigation);
  $('hud-compass').addEventListener('click', async () => {
    $('hud-compass').hidden = await compass.start();
  });
  pmap.map.on('dragstart', () => setFollow(false));
  $<HTMLInputElement>('search').addEventListener('input', (e) => {
    state.query = (e.target as HTMLInputElement).value;
    renderList();
  });
  // Swipe up: meet the animals. Swipe down: back, or close the sheet.
  const sheet = $('sheet');
  let startY: number | null = null;
  let startScroll = 0;
  sheet.addEventListener(
    'touchstart',
    (e) => {
      startY = e.touches[0].clientY;
      startScroll = sheet.scrollTop;
    },
    { passive: true },
  );
  sheet.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    const expanded = sheet.classList.contains('expanded');
    if (dy < -40 && !expanded && !$('more-hint').hidden) setSheetExpanded(true);
    else if (dy > 60 && startScroll <= 0) {
      if (expanded) setSheetExpanded(false);
      else closeSheet();
    }
  });
  $('more-hint').addEventListener('click', () => setSheetExpanded(true));
}

function applyI18n() {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle!)));
  document
    .querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')
    .forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder!)));
  $('btn-expand').title = t(state.expanded ? 'map.collapse' : 'map.expand');
}

function showStatus(msg: string) {
  const el = $('status-banner');
  el.textContent = msg;
  el.hidden = false;
}

function hideStatus() {
  $('status-banner').hidden = true;
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => undefined);
  }
}

init().catch((err) => {
  console.error(err);
  showStatus(String(err));
});
