import logoUrl from './assets/logo-white.png';
import type { ParkData } from './data';
import { poiIcon } from './data';
import { currentLang, formatDistance, pick, t } from './i18n';
import { poiIconSvg } from './poi-icons';
import type { VisitLog } from './visit-log';
import { drawVisitMap, loadImage, visitMapAspect } from './visit-map';

/** End-of-visit summary: what you saw, how far you walked… and an image to share. */
export interface SummaryContext {
  data: ParkData;
  log: VisitLog;
  /** Plan stops done / in the plan, if there is a plan for today. */
  planProgress: () => { done: number; total: number } | null;
  toast: (msg: string, action?: () => void, ms?: number) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SEEN_KINDS = new Set(['animal', 'show', 'experience', 'botanic']);

export function startSummary(ctx: SummaryContext) {
  const byId = new Map(ctx.data.pois.map((p) => [p.id, p]));
  const animalsTotal = ctx.data.pois.filter((p) => p.category === 'animal').length;

  function stats() {
    const v = ctx.log.visit;
    const seen = Object.entries(v.seen)
      .map(([id, min]) => ({ poi: byId.get(id)!, min }))
      .filter((x) => x.poi && SEEN_KINDS.has(x.poi.category));
    const animals = seen.filter((x) => x.poi.category === 'animal');
    const minutes = v.start ? Math.round((v.end - v.start) / 60_000) : 0;
    const fav = [...animals].sort((a, b) => b.min - a.min)[0];
    return { seen, animals, minutes, km: v.meters / 1000, shows: ctx.log.showsWatched(byId), fav };
  }

  const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`);
  const dateText = () => {
    const d = new Intl.DateTimeFormat(currentLang(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
      new Date(`${ctx.log.visit.date}T12:00:00`),
    );
    return d.charAt(0).toUpperCase() + d.slice(1);
  };

  function render() {
    const s = stats();
    $('sum-date').textContent = dateText();
    const cards: [string, string][] = [
      [String(s.animals.length), t('sum.animals', { total: animalsTotal })],
      [formatDistance(s.km * 1000), t('sum.walked')],
      [duration(s.minutes), t('sum.time')],
      [String(s.shows.length), t('sum.shows')],
    ];
    $('sum-stats').innerHTML = cards.map(() => `<div class="sum-stat"><b></b><small></small></div>`).join('');
    $('sum-stats')
      .querySelectorAll('.sum-stat')
      .forEach((el, i) => {
        el.querySelector('b')!.textContent = cards[i][0];
        el.querySelector('small')!.textContent = cards[i][1];
      });
    const plan = ctx.planProgress();
    $('sum-plan').hidden = !plan;
    if (plan) $('sum-plan').textContent = t('sum.plan', { done: plan.done, total: plan.total });
    $('sum-fav').hidden = !s.fav;
    if (s.fav) $('sum-fav').textContent = t('sum.fav', { name: pick(s.fav.poi.name), n: Math.round(s.fav.min) });
    const ul = $('sum-seen');
    ul.innerHTML = '';
    for (const { poi } of s.seen) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="plan-icon cat-${poi.category}">${
        poi.art ? `<img src="${import.meta.env.BASE_URL}${poi.art}" alt="">` : poiIconSvg(poiIcon(poi), 22)
      }</span><span></span>`;
      li.querySelector('span:last-child')!.textContent = pick(poi.name);
      ul.appendChild(li);
    }
    $('sum-empty').hidden = s.seen.length > 0;
    void renderMap();
  }

  const mapOptions = (ground: string, path: string, art: number) => ({
    data: ctx.data,
    seen: new Set(Object.keys(ctx.log.visit.seen)),
    track: ctx.log.visit.track ?? [],
    ground,
    path,
    route: '#a71d2f',
    art,
  });

  /** The map of the visit at the top of the summary. */
  async function renderMap() {
    const c = $<HTMLCanvasElement>('sum-map');
    const w = c.clientWidth;
    if (!w) return;
    const art = Math.max(34, w * 0.11);
    const h = Math.round(Math.min(w * 0.9, (w - art) * visitMapAspect(ctx.data) + art * 0.8));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    await drawVisitMap(g, { x: 0, y: 0, w, h, r: 14 }, mapOptions(v('--chip'), v('--surface'), art));
  }

  function open() {
    $('summary').hidden = false;
    render();
    document.body.classList.add('sheet-open');
  }

  function close() {
    $('summary').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  /** The button under "Plan your visit": shown once something has been seen today. */
  function refreshButton() {
    const has = ctx.log.hasVisit;
    $('sum-open').hidden = !has;
    if (has) $('sum-open-text').textContent = t('sum.button', { n: stats().animals.length });
  }

  // --- the image to share -----------------------------------------------------------
  /**
   * The picture to share, made for Instagram stories (1080×1920, 9:16). Nothing
   * important in the top and bottom 250 px, where Instagram puts its own bars.
   */
  async function shareImage(): Promise<Blob | null> {
    const s = stats();
    await Promise.all([document.fonts.load('60px Cinqcent'), document.fonts.load('30px Public')]).catch(() => undefined);
    const W = 1080;
    const H = 1920;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const red = '#a71d2f';
    const cream = '#fbf6ec';
    const center = (text: string, y: number, font: string, color: string) => {
      g.font = font;
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(text, W / 2, y, W - 120);
    };

    g.fillStyle = cream;
    g.fillRect(0, 0, W, H);

    // red header with a wavy bottom edge
    const waveY = 650;
    const amp = 22;
    const waves = 3.5;
    g.fillStyle = red;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(W, 0);
    for (let x = W; x >= 0; x -= 6) g.lineTo(x, waveY + amp * Math.sin((x / W) * waves * 2 * Math.PI));
    g.closePath();
    g.fill();

    const logo = await loadImage(logoUrl);
    if (logo) g.drawImage(logo, W / 2 - 160, 250, 320, (320 * logo.height) / logo.width);
    center(t('sum.imageTitle'), 525, '76px Cinqcent', '#fff');
    center(dateText(), 585, '34px Public', 'rgba(255,255,255,0.85)');

    // the map of the visit, on a card over the wave
    const art = 110;
    const mapH = Math.round(Math.min(620, (W - 168 - art) * visitMapAspect(ctx.data) + art * 0.8));
    const card = { x: 70, y: 720, w: W - 140, h: mapH + 28, r: 40 };
    g.save();
    g.shadowColor = 'rgba(60,48,20,0.18)';
    g.shadowBlur = 30;
    g.shadowOffsetY = 8;
    g.fillStyle = '#fff';
    g.beginPath();
    g.roundRect(card.x, card.y, card.w, card.h, card.r);
    g.fill();
    g.restore();
    await drawVisitMap(
      g,
      { x: card.x + 14, y: card.y + 14, w: card.w - 28, h: card.h - 28, r: card.r - 12 },
      mapOptions('#f4f0e2', '#ffffff', art),
    );

    // the four numbers
    const cards: [string, string][] = [
      [String(s.animals.length), t('sum.animalsShort')],
      [formatDistance(s.km * 1000), t('sum.walked')],
      [duration(s.minutes), t('sum.time')],
      [String(s.shows.length), t('sum.shows')],
    ];
    cards.forEach(([value, label], i) => {
      const x = 70 + (i % 2) * 480;
      const y = card.y + card.h + 26 + Math.floor(i / 2) * 136;
      g.fillStyle = '#fff';
      g.beginPath();
      g.roundRect(x, y, 460, 122, 30);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = red;
      g.font = `${value.length > 7 ? 56 : 70}px Cinqcent`;
      g.fillText(value, x + 230, y + 70, 420);
      g.fillStyle = '#6b6b60';
      g.font = '28px Public';
      g.fillText(label, x + 230, y + 106, 420);
    });
    let y = card.y + card.h + 26 + 258;

    // a row of the drawings you saw, if there is room above the bottom bar
    const arts = s.animals.filter((x) => x.poi.art).sort((a, b) => b.min - a.min);
    const room = 1690 - 74 - (s.fav ? 54 : 0) - y;
    if (arts.length && room >= 90) {
      const size = Math.min(130, room - 20);
      const n = Math.min(arts.length, Math.floor((W - 140) / (size + 20)));
      const imgs = await Promise.all(arts.slice(0, n).map((x) => loadImage(`${import.meta.env.BASE_URL}${x.poi.art}`)));
      const step = (W - 140) / n;
      imgs.forEach((img, i) => {
        if (!img) return;
        const k = Math.min(size / img.width, size / img.height);
        const cx = 70 + step * (i + 0.5);
        g.drawImage(img, cx - (img.width * k) / 2, y + 10 + (size - img.height * k) / 2, img.width * k, img.height * k);
      });
      y += size + 20;
    }
    y += 20;
    if (s.fav) {
      center(t('sum.fav', { name: pick(s.fav.poi.name), n: Math.round(s.fav.min) }), y + 30, '32px Public', '#2a2a24');
      y += 54;
    }
    center(t('sum.imageFooter'), y + 30, '600 30px Public', red);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  async function share() {
    const blob = await shareImage();
    if (!blob) return;
    const file = new File([blob], `oasis-wildlife-${ctx.log.visit.date}.png`, { type: 'image/png' });
    const text = t('sum.shareText', { n: stats().animals.length });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    // no file sharing here: save the picture
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    ctx.toast(t('sum.saved'));
  }

  $('sum-open').addEventListener('click', open);
  $('sum-ask-no').addEventListener('click', () => ($('sum-ask').hidden = true));
  $('sum-ask-yes').addEventListener('click', () => {
    $('sum-ask').hidden = true;
    open();
  });
  $('sum-close').addEventListener('click', close);
  $('sum-done').addEventListener('click', close);
  $('sum-share').addEventListener('click', () => void share());
  refreshButton();

  return {
    open,
    refresh: () => {
      refreshButton();
      if (!$('summary').hidden) render();
    },
    /** Shown once, when the visitor leaves the park after a visit of a while. */
    offerOnLeaving() {
      const v = ctx.log.visit;
      if (v.offered || !ctx.log.hasVisit || v.end - v.start < 30 * 60_000) return;
      ctx.log.setOffered();
      $('sum-ask').hidden = false; // stays until answered: on the way out you may not be looking
    },
  };
}

export type SummaryApi = ReturnType<typeof startSummary>;
