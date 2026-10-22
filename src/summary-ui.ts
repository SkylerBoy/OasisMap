import logoUrl from './assets/logo-white.png';
import type { ParkData } from './data';
import { poiIcon } from './data';
import { currentLang, formatDistance, pick, t } from './i18n';
import { poiIconSvg } from './poi-icons';
import type { VisitLog } from './visit-log';

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
    const cards: [string, string, string][] = [
      ['🐾', String(s.animals.length), t('sum.animals', { total: animalsTotal })],
      ['🚶', formatDistance(s.km * 1000), t('sum.walked')],
      ['⏱️', duration(s.minutes), t('sum.time')],
      ['🎓', String(s.shows.length), t('sum.shows')],
    ];
    $('sum-stats').innerHTML = cards
      .map(([icon]) => `<div class="sum-stat"><span aria-hidden="true">${icon}</span><b></b><small></small></div>`)
      .join('');
    $('sum-stats')
      .querySelectorAll('.sum-stat')
      .forEach((el, i) => {
        el.querySelector('b')!.textContent = cards[i][1];
        el.querySelector('small')!.textContent = cards[i][2];
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
  }

  function open() {
    render();
    $('summary').hidden = false;
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
  const loadImage = (src: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  async function shareImage(): Promise<Blob | null> {
    const s = stats();
    await Promise.all([document.fonts.load('60px Cinqcent'), document.fonts.load('30px Public')]).catch(() => undefined);
    const W = 1080;
    const H = 1350;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const red = '#a71d2f';
    const ink = '#2a2a24';
    const center = (text: string, y: number, font: string, color: string) => {
      g.font = font;
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(text, W / 2, y);
    };
    const round = (x: number, y: number, w: number, h: number, r: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fill();
    };

    g.fillStyle = '#fbf6ec';
    g.fillRect(0, 0, W, H);
    g.fillStyle = red;
    g.fillRect(0, 0, W, 420);
    const logo = await loadImage(logoUrl);
    if (logo) g.drawImage(logo, W / 2 - 150, 50, 300, (300 * logo.height) / logo.width);
    center(t('sum.imageTitle'), 330, '64px Cinqcent', '#fff');
    center(dateText(), 385, '32px Public', 'rgba(255,255,255,0.85)');

    // the four numbers
    const cards: [string, string][] = [
      [String(s.animals.length), t('sum.animalsShort')],
      [formatDistance(s.km * 1000), t('sum.walked')],
      [duration(s.minutes), t('sum.time')],
      [String(s.shows.length), t('sum.shows')],
    ];
    cards.forEach(([value, label], i) => {
      const x = 60 + (i % 2) * 490;
      const y = 460 + Math.floor(i / 2) * 200;
      round(x, y, 470, 180, 28, '#fff');
      g.textAlign = 'center';
      g.fillStyle = red;
      g.font = `${value.length > 7 ? 64 : 84}px Cinqcent`;
      g.fillText(value, x + 235, y + 105);
      g.fillStyle = '#6b6b60';
      g.font = '30px Public';
      g.fillText(label, x + 235, y + 152);
    });

    // drawings of what you saw
    const arts = s.seen.filter((x) => x.poi.art).slice(0, 12);
    const imgs = await Promise.all(arts.map((x) => loadImage(`${import.meta.env.BASE_URL}${x.poi.art}`)));
    const cols = 4;
    imgs.forEach((img, i) => {
      if (!img) return;
      const cx = 60 + (i % cols) * 240 + 110;
      const cy = 900 + Math.floor(i / cols) * 120 + 50;
      const scale = Math.min(200 / img.width, 100 / img.height);
      g.drawImage(img, cx - (img.width * scale) / 2, cy - (img.height * scale) / 2, img.width * scale, img.height * scale);
    });
    if (s.fav) center(t('sum.fav', { name: pick(s.fav.poi.name), n: Math.round(s.fav.min) }), 1270, '32px Public', ink);
    center(t('sum.imageFooter'), 1318, '28px Public', red);
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
