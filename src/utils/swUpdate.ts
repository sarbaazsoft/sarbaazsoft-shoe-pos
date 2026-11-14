import { isProductionCachingEnabled } from './cachePolicy.ts';

declare global {
  interface Window {
    __POS_HOLD_SW_UPDATE__?: boolean;
    __POS_WAITING_SW__?: ServiceWorker | null;
  }
}

const SW_RELOAD_GUARD_KEY = '__pos_sw_reload_at';
const CHUNK_RELOAD_GUARD_KEY = '__pos_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 15_000;
const VERSION_CHECK_THROTTLE_MS = 60_000;

export function canTriggerSafeReload(storageKey: string = SW_RELOAD_GUARD_KEY): boolean {
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

    if (!canTriggerSafeReload(CHUNK_RELOAD_GUARD_KEY)) {
      return;
    }

    const triggerReload = () => {
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

let versionSyncRegistered = false;

export function registerProductionVersionSync(): () => void {
  if (typeof window === 'undefined' || !isProductionCachingEnabled() || versionSyncRegistered) {
    return () => {};
  }
  versionSyncRegistered = true;

  const metaEl = document.querySelector('meta[name="app-build-version"]');
  const currentVersion = metaEl?.getAttribute('content')?.trim() || '';
  if (!currentVersion) {
    return () => {};
  }

  let lastCheckedAt = 0;

  const checkForNewDeployment = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (window.__POS_HOLD_SW_UPDATE__) return;

    const now = Date.now();
    if (now - lastCheckedAt < VERSION_CHECK_THROTTLE_MS) return;
    lastCheckedAt = now;

    try {
      const res = await fetch(`/version.json?t=${now}`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      const remoteVersion = String(payload?.version || '').trim();
      if (!remoteVersion || remoteVersion === currentVersion) return;

      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
        if (reg) {
          await reg.update().catch(() => {});
          if (reg.waiting && !window.__POS_HOLD_SW_UPDATE__) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            return;
          }
          if (reg.installing) {
            return;
          }
        }
      }

      if (!window.__POS_HOLD_SW_UPDATE__ && canTriggerSafeReload(SW_RELOAD_GUARD_KEY)) {
        window.location.reload();
      }
    } catch {
      // Ignore network blips during background version probe
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      void checkForNewDeployment();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void checkForNewDeployment();
    }
  }, 5 * 60_000);

  return () => {
    versionSyncRegistered = false;
    document.removeEventListener('visibilitychange', handleVisibility);
    clearInterval(timer);
  };
}
