import { t } from './i18n';

/**
 * Time picker in the park's style (the phone's own picker cannot be styled):
 * two snapping wheels, hours and minutes, in a bottom panel.
 */

const ROW = 44; // px per wheel row

function wheel(values: number[], selected: number, label: (v: number) => string): { el: HTMLElement; value: () => number } {
  const el = document.createElement('div');
  el.className = 'tp-wheel';
  el.innerHTML = `<div class="tp-pad"></div>${values.map((v) => `<div class="tp-item" data-v="${v}">${label(v)}</div>`).join('')}<div class="tp-pad"></div>`;
  const index = () => Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ROW)));
  const mark = () => {
    const i = index();
    el.querySelectorAll('.tp-item').forEach((n, k) => n.classList.toggle('on', k === i));
  };
  el.addEventListener('scroll', mark, { passive: true });
  el.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.tp-item');
    if (item) el.scrollTo({ top: values.indexOf(Number(item.dataset.v)) * ROW, behavior: 'smooth' });
  });
  requestAnimationFrame(() => {
    const k = values.reduce((best, v, i) => (Math.abs(v - selected) < Math.abs(values[best] - selected) ? i : best), 0);
    el.scrollTop = k * ROW;
    mark();
  });
  return { el, value: () => values[index()] };
}

/** Ask for a time "H:MM"; resolves to null if cancelled. */
export function pickTime(
  title: string,
  current: string,
  opts: { min?: string; max?: string; step?: number } = {},
): Promise<string | null> {
  const toMin = (s: string) => s.split(':').map(Number).reduce((h, m) => h * 60 + m);
  const lo = toMin(opts.min ?? '8:00');
  const hi = toMin(opts.max ?? '20:00');
  const [h0, m0] = current.split(':').map(Number);
  const hours = Array.from({ length: Math.floor(hi / 60) - Math.floor(lo / 60) + 1 }, (_, i) => Math.floor(lo / 60) + i);
  const step = opts.step ?? 5;
  const mins = Array.from({ length: 60 / step }, (_, i) => i * step);

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'tp';
    root.innerHTML = `
      <div class="tp-backdrop"></div>
      <div class="tp-sheet" role="dialog" aria-modal="true">
        <h3 class="tp-title"></h3>
        <div class="tp-wheels"><div class="tp-band" aria-hidden="true"></div><span class="tp-colon">:</span></div>
        <div class="tp-actions">
          <button type="button" class="btn tp-cancel"></button>
          <button type="button" class="btn primary tp-ok"></button>
        </div>
      </div>`;
    root.querySelector('.tp-title')!.textContent = title;
    root.querySelector('.tp-cancel')!.textContent = t('cancel');
    root.querySelector('.tp-ok')!.textContent = t('done');
    const hw = wheel(hours, h0, (v) => String(v));
    const mw = wheel(mins, m0, (v) => String(v).padStart(2, '0'));
    const box = root.querySelector('.tp-wheels')!;
    box.prepend(hw.el);
    box.append(mw.el);
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('open'));

    const finish = (v: string | null) => {
      root.classList.remove('open');
      setTimeout(() => root.remove(), 220);
      resolve(v);
    };
    root.querySelector('.tp-backdrop')!.addEventListener('click', () => finish(null));
    root.querySelector('.tp-cancel')!.addEventListener('click', () => finish(null));
    root.querySelector('.tp-ok')!.addEventListener('click', () => {
      // keep it within the allowed range (e.g. 16:45 when the latest is 16:30)
      const v = Math.min(hi, Math.max(lo, hw.value() * 60 + mw.value()));
      finish(`${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`);
    });
  });
}

/** Choose one option from a list, in the same bottom panel as the time picker. */
export function pickOption<T extends string | number>(
  title: string,
  options: { value: T; label: string }[],
  current: T,
): Promise<T | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'tp';
    root.innerHTML = `
      <div class="tp-backdrop"></div>
      <div class="tp-sheet" role="dialog" aria-modal="true">
        <h3 class="tp-title"></h3>
        <ul class="tp-options" role="listbox"></ul>
      </div>`;
    root.querySelector('.tp-title')!.textContent = title;
    const ul = root.querySelector('.tp-options')!;
    const finish = (v: T | null) => {
      root.classList.remove('open');
      setTimeout(() => root.remove(), 220);
      resolve(v);
    };
    for (const o of options) {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" role="option" aria-selected="${o.value === current}"><span></span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></button>`;
      li.querySelector('span')!.textContent = o.label;
      li.querySelector('button')!.addEventListener('click', () => finish(o.value));
      ul.appendChild(li);
    }
    root.querySelector('.tp-backdrop')!.addEventListener('click', () => finish(null));
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('open'));
  });
}
