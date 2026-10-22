import giraffeUrl from './assets/giraffe.svg';
import logoUrl from './assets/logo-white.png';
import type { ParkData } from './data';
import { poiIcon } from './data';
import { currentLang, formatDistance, pick, t } from './i18n';
import { poiIconSvg } from './poi-icons';
import type { BaseLayer } from './map';
import type { VisitLog } from './visit-log';
import { DARK_MAP, drawVisitMap, LIGHT_MAP, loadImage, type MapColors } from './visit-map';

/** End-of-visit summary: what you saw, how far you walked… and an image to share. */
export interface SummaryContext {
  data: ParkData;
  log: VisitLog;
  /** Plan stops done / in the plan, if there is a plan for today. */
  planProgress: () => { done: number; total: number } | null;
  toast: (msg: string, action?: () => void, ms?: number) => void;
  /** Base layer of the map (street map or satellite), for the picture of the map. */
  mapBase: () => BaseLayer;
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
    if (s.fav) {
      const img = $('sum-fav').querySelector('img')!;
      img.hidden = !s.fav.poi.art;
      if (s.fav.poi.art) img.src = `${import.meta.env.BASE_URL}${s.fav.poi.art}`;
      $('sum-fav-name').textContent = pick(s.fav.poi.name);
      $('sum-fav-min').textContent = `${Math.round(s.fav.min)} min`;
    }
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

  const mapOptions = (colors: MapColors, art: number, density: number, pixelRatio: number, dark: boolean) => ({
    data: ctx.data,
    seen: new Set(Object.keys(ctx.log.visit.seen)),
    track: ctx.log.visit.track ?? [],
    colors,
    art,
    base: ctx.mapBase(),
    dark,
    density,
    pixelRatio,
  });
  let mapKey = '';
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
    const h = Math.round(w * 0.8);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const v = ctx.log.visit;
    const dark = isDark();
    // a picture of the map costs a moment: only again when something changed
    const key = [w, dark, ctx.mapBase(), v.track?.length ?? 0, Object.keys(v.seen).length].join();
    if (key === mapKey) return;
    mapKey = key;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    await drawVisitMap(g, { x: 0, y: 0, w, h, r: 14 }, mapOptions(dark ? DARK_MAP : LIGHT_MAP, art, 1, dpr, dark));
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
  /** The giraffe-skin pattern of the web, in a colour, at a size. */
  async function giraffe(g: CanvasRenderingContext2D, color: string, size: number) {
    const svg = await loadImage(giraffeUrl);
    if (!svg) return null;
    const tile = document.createElement('canvas');
    tile.width = tile.height = size;
    const tg = tile.getContext('2d')!;
    tg.drawImage(svg, 0, 0, size, size);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = color;
    tg.fillRect(0, 0, size, size);
    return g.createPattern(tile, 'repeat');
  }

  /**
   * The picture to share, made for Instagram stories (1080×1920, 9:16). Nothing
   * important in the top and bottom bands, where Instagram puts its own bars.
   */
  async function shareImage(): Promise<Blob | null> {
    const s = stats();
    await Promise.all([document.fonts.load('60px Cinqcent'), document.fonts.load('700 30px Public'), document.fonts.load('30px Public')]).catch(
      () => undefined,
    );
    const W = 1080;
    const H = 1920;
    const M = 70; // side margin
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const red = '#a71d2f';
    const muted = '#6b6b60';
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
    const card = (x: number, y: number, w: number, h: number, r: number) => {
      shadow(22, 6, 0.12);
      g.fillStyle = '#fff';
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fill();
      noShadow();
    };

    // cream page with the giraffe pattern
    g.fillStyle = '#fbf6ec';
    g.fillRect(0, 0, W, H);
    const cream = await giraffe(g, 'rgba(176,136,64,0.16)', 340);
    if (cream) {
      g.fillStyle = cream;
      g.fillRect(0, 0, W, H);
    }

    // red header with a wavy bottom edge, the logo and the date
    const waveY = 500;
    const header = new Path2D();
    header.moveTo(0, 0);
    header.lineTo(W, 0);
    for (let x = W; x >= 0; x -= 6) header.lineTo(x, waveY + 22 * Math.sin((x / W) * 3.5 * 2 * Math.PI));
    header.closePath();
    g.fillStyle = red;
    g.fill(header);
    const onRed = await giraffe(g, 'rgba(255,255,255,0.07)', 340);
    if (onRed) {
      g.fillStyle = onRed;
      g.fill(header);
    }
    const logo = await loadImage(logoUrl);
    const lw = 460;
    const lh = logo ? (lw * logo.height) / logo.width : 0;
    if (logo) g.drawImage(logo, W / 2 - lw / 2, 110, lw, lh);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = '36px Public';
    g.fillText(dateText(), W / 2, 110 + lh + 58, W - 2 * M);

    // the map of the visit
    const hasPhotos = photos.length > 0;
    const mapBox = { x: M, y: 545, w: W - 2 * M, h: hasPhotos ? 420 : 760, r: 40 };
    card(mapBox.x, mapBox.y, mapBox.w, mapBox.h, mapBox.r);
    await drawVisitMap(
      g,
      { x: mapBox.x + 12, y: mapBox.y + 12, w: mapBox.w - 24, h: mapBox.h - 24, r: mapBox.r - 10 },
      mapOptions(LIGHT_MAP, 100, 2, 2, false),
    );
    let y = mapBox.y + mapBox.h;

    // your photos, pinned under the map
    if (hasPhotos) {
      const n = photos.length;
      const size = n === 1 ? [400, 270] : n === 2 ? [360, 255] : [262, 215];
      const tilt = [-4, 3.5, -2.5];
      const top = y + 36;
      photos.forEach(({ img }, i) => {
        const [pw, ph] = size;
        const cx = n === 1 ? W / 2 : M + ((W - 2 * M) / n) * (i + 0.5);
        const cy = top + ph / 2 + 12 + (i % 2) * 8;
        g.save();
        g.translate(cx, cy);
        g.rotate((tilt[(i + (n === 1 ? 1 : 0)) % 3] * Math.PI) / 180);
        shadow(18, 6, 0.25);
        g.fillStyle = '#fff';
        g.fillRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 24);
        noShadow();
        const k = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
        const sw = pw / k;
        const sh = ph / k;
        g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, -pw / 2, -ph / 2, pw, ph);
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
      y = top + size[1] + 40;
    }

    // the numbers, and your favourite animal beside them
    y += 26;
    const cards: [string, string][] = [
      [String(s.animals.length), t('sum.animalsShort')],
      [formatDistance(s.km * 1000), t('sum.walked')],
      [duration(s.minutes), t('sum.time')],
      [String(s.shows.length), t('sum.shows')],
    ];
    const favW = s.fav ? 330 : 0;
    const gap = 14;
    const gridW = W - 2 * M - (favW ? favW + 16 : 0);
    const cw = (gridW - gap) / 2;
    const ch = 122;
    cards.forEach(([value, label], i) => {
      const x = M + (i % 2) * (cw + gap);
      const cy = y + Math.floor(i / 2) * (ch + gap);
      card(x, cy, cw, ch, 28);
      g.textAlign = 'center';
      g.fillStyle = red;
      g.font = `700 ${value.length > 7 ? 42 : 58}px Public`;
      g.fillText(value, x + cw / 2, cy + 68, cw - 24);
      g.fillStyle = muted;
      g.font = '25px Public';
      g.fillText(label, x + cw / 2, cy + 104, cw - 20);
    });
    if (s.fav) {
      const fx = W - M - favW;
      const fh = 2 * ch + gap;
      card(fx, y, favW, fh, 28);
      const art = s.fav.poi.art ? await loadImage(`${import.meta.env.BASE_URL}${s.fav.poi.art}`) : null;
      if (art) {
        const k = Math.min(200 / art.width, 118 / art.height);
        g.drawImage(art, fx + favW / 2 - (art.width * k) / 2, y + 18 + (118 - art.height * k) / 2, art.width * k, art.height * k);
      }
      // a red label, like a rosette
      const label = t('sum.favLabel').toUpperCase();
      g.font = '700 20px Public';
      const lw2 = g.measureText(label).width + 32;
      g.fillStyle = red;
      g.beginPath();
      g.roundRect(fx + favW / 2 - lw2 / 2, y + 146, lw2, 34, 17);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.fillText(label, fx + favW / 2, y + 170);
      g.fillStyle = '#2a2a24';
      g.font = '38px Cinqcent';
      g.fillText(pick(s.fav.poi.name), fx + favW / 2, y + 218, favW - 30);
      g.fillStyle = muted;
      g.font = '24px Public';
      g.fillText(`${Math.round(s.fav.min)} min`, fx + favW / 2, y + 248);
    }

    // the link, bottom left
    g.textAlign = 'left';
    g.fillStyle = muted;
    g.font = '26px Public';
    g.fillText(t('sum.imageInvite'), M, 1690);
    g.fillStyle = red;
    g.font = '700 30px Public';
    g.fillText(t('sum.imageUrl'), M, 1730);
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
