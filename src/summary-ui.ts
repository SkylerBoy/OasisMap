import logoUrl from './assets/logo-white.png';
import type { ParkData } from './data';
import { poiIcon } from './data';
import { currentLang, formatDistance, pick, t } from './i18n';
import { poiIconSvg } from './poi-icons';
import type { VisitLog } from './visit-log';
import { DARK_MAP, drawVisitMap, LIGHT_MAP, loadImage, type MapColors, visitMapAspect } from './visit-map';

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
    renderPhotos();
    void renderMap();
  }

  const mapOptions = (colors: MapColors, art: number) => ({
    data: ctx.data,
    seen: new Set(Object.keys(ctx.log.visit.seen)),
    track: ctx.log.visit.track ?? [],
    colors,
    art,
  });
  const isDark = () => {
    const forced = document.documentElement.dataset.theme;
    return forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  /** The map of the visit at the top of the summary. */
  async function renderMap() {
    const c = $<HTMLCanvasElement>('sum-map');
    const w = c.clientWidth;
    if (!w) return;
    const art = Math.max(34, w * 0.11);
    const h = Math.round(Math.min(w * 0.9, (w - art * 1.16) * visitMapAspect(ctx.data) + art * 1.16));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    await drawVisitMap(g, { x: 0, y: 0, w, h, r: 14 }, mapOptions(isDark() ? DARK_MAP : LIGHT_MAP, art));
  }

  // --- your photos for the picture (optional, kept only while the app is open) ----
  const MAX_PHOTOS = 3;
  const photos: { url: string; img: HTMLImageElement }[] = [];
  const PLUS = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

  function renderPhotos() {
    const box = $('sum-photo-list');
    box.innerHTML = '';
    photos.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'sum-photo';
      el.innerHTML = `<img alt=""><button type="button" class="sum-photo-x">${CROSS}</button>`;
      el.querySelector('img')!.src = p.url;
      el.querySelector('button')!.title = t('sum.removePhoto');
      el.querySelector('button')!.addEventListener('click', () => {
        URL.revokeObjectURL(p.url);
        photos.splice(i, 1);
        renderPhotos();
      });
      box.appendChild(el);
    });
    if (photos.length < MAX_PHOTOS) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'sum-photo sum-photo-add';
      add.innerHTML = `${PLUS}<small></small>`;
      add.querySelector('small')!.textContent = t('sum.addPhoto');
      add.addEventListener('click', () => $<HTMLInputElement>('sum-photo-input').click());
      box.appendChild(add);
    }
  }

  $<HTMLInputElement>('sum-photo-input').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])].slice(0, MAX_PHOTOS - photos.length);
    input.value = '';
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = url;
      });
      if (img) photos.push({ url, img });
      else URL.revokeObjectURL(url);
    }
    renderPhotos();
  });

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
    const BOTTOM = 1680; // below this, Instagram's reply bar
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const red = '#a71d2f';
    const center = (text: string, y: number, font: string, color: string) => {
      g.font = font;
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(text, W / 2, y, W - 120);
    };
    const shadow = (blur: number, dy: number, alpha = 0.18) => {
      g.shadowColor = `rgba(60,48,20,${alpha})`;
      g.shadowBlur = blur;
      g.shadowOffsetY = dy;
    };
    const noShadow = () => {
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
    };

    g.fillStyle = '#fbf6ec';
    g.fillRect(0, 0, W, H);

    // red header with a wavy bottom edge
    const waveY = 610;
    g.fillStyle = red;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(W, 0);
    for (let x = W; x >= 0; x -= 6) g.lineTo(x, waveY + 22 * Math.sin((x / W) * 3.5 * 2 * Math.PI));
    g.closePath();
    g.fill();

    const logo = await loadImage(logoUrl);
    if (logo) g.drawImage(logo, W / 2 - 140, 240, 280, (280 * logo.height) / logo.width);
    center(t('sum.imageTitle'), 495, '72px Cinqcent', '#fff');
    center(dateText(), 552, '32px Public', 'rgba(255,255,255,0.85)');

    // the map of the visit, on a white card
    const hasPhotos = photos.length > 0;
    const art = 104;
    const maxMap = hasPhotos ? 440 : 600;
    const mapH = Math.round(Math.min(maxMap, (W - 168 - art * 1.16) * visitMapAspect(ctx.data) + art * 1.16));
    const card = { x: 70, y: 660, w: W - 140, h: mapH + 28, r: 40 };
    shadow(30, 8);
    g.fillStyle = '#fff';
    g.beginPath();
    g.roundRect(card.x, card.y, card.w, card.h, card.r);
    g.fill();
    noShadow();
    await drawVisitMap(
      g,
      { x: card.x + 14, y: card.y + 14, w: card.w - 28, h: card.h - 28, r: card.r - 12 },
      mapOptions(LIGHT_MAP, art),
    );
    let y = card.y + card.h;

    // your photos, pinned under the map
    if (hasPhotos) {
      const n = photos.length;
      const size = n === 1 ? [470, 330] : n === 2 ? [400, 290] : [262, 220];
      const tilt = [-4, 3.5, -2.5];
      const top = y + 34;
      photos.forEach(({ img }, i) => {
        const [pw, ph] = size;
        const cx = n === 1 ? W / 2 : 70 + ((W - 140) / n) * (i + 0.5);
        const cy = top + ph / 2 + 14 + (i % 2) * 10;
        g.save();
        g.translate(cx, cy);
        g.rotate((tilt[(i + (n === 1 ? 1 : 0)) % 3] * Math.PI) / 180);
        shadow(18, 6, 0.25);
        g.fillStyle = '#fff';
        g.fillRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 24);
        noShadow();
        // fill the frame, cropping the photo
        const k = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
        const sw = pw / k;
        const sh = ph / k;
        g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, -pw / 2, -ph / 2, pw, ph);
        // the pin
        const py = -ph / 2 - 4;
        shadow(6, 4, 0.35);
        const grad = g.createRadialGradient(-5, py - 5, 2, 0, py, 16);
        grad.addColorStop(0, '#ff7686');
        grad.addColorStop(1, red);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, py, 15, 0, 2 * Math.PI);
        g.fill();
        noShadow();
        g.restore();
      });
      y = top + size[1] + 50;
    }

    // the numbers: a row of four with photos, two by two without
    const cards: [string, string][] = [
      [String(s.animals.length), t('sum.animalsShort')],
      [formatDistance(s.km * 1000), t('sum.walked')],
      [duration(s.minutes), t('sum.time')],
      [String(s.shows.length), t('sum.shows')],
    ];
    const cols = hasPhotos ? 4 : 2;
    const gap = hasPhotos ? 14 : 20;
    const cw = (W - 140 - gap * (cols - 1)) / cols;
    const ch = hasPhotos ? 112 : 122;
    y += 26;
    cards.forEach(([value, label], i) => {
      const x = 70 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + 14);
      g.fillStyle = '#fff';
      g.beginPath();
      g.roundRect(x, cy, cw, ch, 28);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = red;
      g.font = `${hasPhotos ? (value.length > 6 ? 38 : 50) : value.length > 7 ? 56 : 70}px Cinqcent`;
      g.fillText(value, x + cw / 2, cy + (hasPhotos ? 60 : 70), cw - 24);
      g.fillStyle = '#6b6b60';
      g.font = `${hasPhotos ? 22 : 28}px Public`;
      g.fillText(label, x + cw / 2, cy + (hasPhotos ? 94 : 106), cw - 20);
    });
    y += Math.ceil(4 / cols) * (ch + 14);

    // without photos: a row of the drawings you saw, if there is room
    const arts = s.animals.filter((x) => x.poi.art).sort((a, b) => b.min - a.min);
    const room = BOTTOM - 74 - (s.fav ? 54 : 0) - y;
    if (!hasPhotos && arts.length && room >= 90) {
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
    y += 10;
    if (s.fav) {
      center(t('sum.fav', { name: pick(s.fav.poi.name), n: Math.round(s.fav.min) }), y + 30, '32px Public', '#2a2a24');
      y += 54;
    }
    center(t('sum.imageFooter'), y + 30, '600 30px Public', red);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  const fileName = () => `oasis-wildlife-${ctx.log.visit.date}.png`;

  /** Save the picture on the phone. */
  async function download(blob?: Blob | null) {
    blob ??= await shareImage();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    ctx.toast(t('sum.saved'));
  }

  async function share() {
    const blob = await shareImage();
    if (!blob) return;
    const file = new File([blob], fileName(), { type: 'image/png' });
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
    await download(blob);
  }

  $('sum-open').addEventListener('click', open);
  $('sum-ask-no').addEventListener('click', () => ($('sum-ask').hidden = true));
  $('sum-ask-yes').addEventListener('click', () => {
    $('sum-ask').hidden = true;
    open();
  });
  $('sum-close').addEventListener('click', close);
  $('sum-download').addEventListener('click', () => void download());
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
