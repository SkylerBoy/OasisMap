/**
 * PIN gate for developer mode (?mode=dev).
 *
 * This only keeps visitors out of the staff tools; it is not real security:
 * the code is public and a 4-digit PIN can be guessed. Only a hash of the PIN
 * is stored here, so it is not readable at a glance. To change the PIN, set
 * PIN_HASH to sha256("oasismap-dev:<new pin>").
 */
const PIN_HASH = '6c706d472209e1ceeed8f051da5621682782d0aabb622bda7bed8a830d3a465b';
const SESSION_KEY = 'oasismap.dev';
const MAX_TRIES = 5;
const LOCK_MS = 30_000;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function remembered(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Resolves true once the right PIN is entered (remembered for the session), false on cancel. */
export function unlockDevMode(): Promise<boolean> {
  if (remembered()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pin-overlay';
    overlay.innerHTML = `
      <form class="pin-card" autocomplete="off">
        <h2>Modo desarrollador</h2>
        <p>Introduce el PIN de 4 dígitos.</p>
        <input id="pin-input" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*"
               maxlength="4" aria-label="PIN" />
        <p id="pin-error" class="pin-error" role="alert"></p>
        <div class="pin-actions">
          <button type="button" class="btn" id="pin-cancel">Cancelar</button>
          <button type="submit" class="btn primary" id="pin-ok">Entrar</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form')!;
    const input = overlay.querySelector<HTMLInputElement>('#pin-input')!;
    const error = overlay.querySelector<HTMLElement>('#pin-error')!;
    const ok = overlay.querySelector<HTMLButtonElement>('#pin-ok')!;
    let tries = 0;
    setTimeout(() => input.focus(), 50);

    const done = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      error.textContent = '';
      if (input.value.length === 4) form.requestSubmit();
    });

    overlay.querySelector('#pin-cancel')!.addEventListener('click', () => done(false));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (ok.disabled || input.value.length !== 4) return;
      if ((await sha256(`oasismap-dev:${input.value}`)) === PIN_HASH) {
        try {
          sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
          /* private mode: ask again next time */
        }
        return done(true);
      }
      tries++;
      input.value = '';
      if (tries >= MAX_TRIES) {
        tries = 0;
        ok.disabled = input.disabled = true;
        error.textContent = 'Demasiados intentos. Espera 30 segundos.';
        setTimeout(() => {
          ok.disabled = input.disabled = false;
          error.textContent = '';
          input.focus();
        }, LOCK_MS);
      } else {
        error.textContent = 'PIN incorrecto.';
        input.focus();
      }
    });
  });
}
