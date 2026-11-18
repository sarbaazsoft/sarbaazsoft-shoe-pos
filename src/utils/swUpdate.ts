declare global {
  interface Window {
    __POS_HOLD_SW_UPDATE__?: boolean;
    __POS_WAITING_SW__?: ServiceWorker | null;
  }
}

const CHUNK_RELOAD_GUARD_KEY = '__pos_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 15_000;

export function canTriggerSafeReload(storageKey: string = CHUNK_RELOAD_GUARD_KEY): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    const now = Date.now();
    if (raw) {
      const lastReloadAt = Number(raw);
      if (Number.isFinite(lastReloadAt) && now - lastReloadAt < RELOAD_COOLDOWN_MS) {
        return false;
      }
    }
    window.sessionStorage.setItem(storageKey, String(now));
  } catch {
    // Ignore sessionStorage restrictions in private/sandboxed contexts
  }
  return true;
}

export function flushPendingSwUpdate(): void {
  if (typeof window === 'undefined' || window.__POS_HOLD_SW_UPDATE__) {
    return;
  }

  const waiting = window.__POS_WAITING_SW__;
  if (waiting && waiting.state === 'installed') {
    window.__POS_WAITING_SW__ = null;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (registration?.waiting && !window.__POS_HOLD_SW_UPDATE__) {
          window.__POS_WAITING_SW__ = null;
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      })
      .catch(() => {});
  }
}

export function setHoldSwUpdate(hold: boolean): void {
  if (typeof window === 'undefined') return;
  window.__POS_HOLD_SW_UPDATE__ = hold;
  if (!hold) {
    flushPendingSwUpdate();
  }
}

let chunkRecoveryRegistered = false;

export function registerViteChunkErrorRecovery(): void {
  if (typeof window === 'undefined' || chunkRecoveryRegistered) return;
  chunkRecoveryRegistered = true;

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();

    // Never reload the app while offline; reloading would destroy the live offline POS session
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }

    if (!canTriggerSafeReload(CHUNK_RELOAD_GUARD_KEY)) {
      return;
    }

    const triggerReload = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }
      window.location.reload();
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then(async (registration) => {
          if (registration?.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else if (registration) {
            await registration.update().catch(() => {});
          }
        })
        .catch(() => {})
        .finally(triggerReload);
      return;
    }

    triggerReload();
  });
}
