import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';

export type ResendCooldownFlow = 'email_verification' | 'password_reset';

export interface ResendCooldownPayload {
  flow?: ResendCooldownFlow | string;
  attemptCount?: number;
  cooldownSeconds?: number;
  remainingSeconds?: number;
  nextAvailableAt?: string | null;
  isInCooldown?: boolean;
  blockedByIp?: boolean;
}

interface PersistedCooldownState {
  attemptCount: number;
  cooldownSeconds: number;
  nextAvailableAt: string | null;
  blockedByIp?: boolean;
}

export const RESEND_COOLDOWN_STORAGE_PREFIX = 'pos_resend_cooldown_';

export function buildCooldownStorageKey(flow: ResendCooldownFlow, email?: string): string {
  const cleanEmail = String(email || '').trim().toLowerCase() || 'anonymous';
  return `${RESEND_COOLDOWN_STORAGE_PREFIX}${flow}_${cleanEmail}`;
}

export function formatCountdownMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatNextAvailableClock(
  nextAvailableAt: string | null | undefined,
  remainingSeconds: number
): string | null {
  if (remainingSeconds <= 0) return null;
  const targetMs = nextAvailableAt
    ? new Date(nextAvailableAt).getTime()
    : Date.now() + remainingSeconds * 1000;
  if (!Number.isFinite(targetMs)) return null;
  try {
    return new Date(targetMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function computeRemainingSeconds(nextAvailableAt: string | null | undefined): number {
  if (!nextAvailableAt) return 0;
  const expiresMs = new Date(nextAvailableAt).getTime();
  if (!Number.isFinite(expiresMs)) return 0;
  const diffMs = expiresMs - Date.now();
  return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
}

function readPersistedCooldown(storageKey: string): PersistedCooldownState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedCooldownState>;
    const remaining = computeRemainingSeconds(parsed.nextAvailableAt);
    return {
      attemptCount: Number(parsed.attemptCount || 0),
      cooldownSeconds: remaining > 0 ? Number(parsed.cooldownSeconds || remaining) : 0,
      nextAvailableAt: remaining > 0 ? parsed.nextAvailableAt || null : null,
      blockedByIp: Boolean(parsed.blockedByIp && remaining > 0),
    };
  } catch {
    return null;
  }
}

function writePersistedCooldown(storageKey: string, state: PersistedCooldownState | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!state || (!state.nextAvailableAt && state.attemptCount <= 0)) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage quota / privacy mode restrictions
  }
}

export function useResendCooldown(options: {
  flow: ResendCooldownFlow;
  email?: string;
  enabled?: boolean;
}) {
  const { flow, email = '', enabled = true } = options;
  const normalizedEmail = email.trim().toLowerCase();
  const storageKey = buildCooldownStorageKey(flow, normalizedEmail);

  const [state, setState] = useState<PersistedCooldownState>(() => {
    return (
      readPersistedCooldown(storageKey) || {
        attemptCount: 0,
        cooldownSeconds: 0,
        nextAvailableAt: null,
        blockedByIp: false,
      }
    );
  });

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    computeRemainingSeconds(state.nextAvailableAt)
  );

  // Sync local cached state when email/flow changes
  useEffect(() => {
    const cached = readPersistedCooldown(storageKey) || {
      attemptCount: 0,
      cooldownSeconds: 0,
      nextAvailableAt: null,
      blockedByIp: false,
    };
    setState(cached);
    setRemainingSeconds(computeRemainingSeconds(cached.nextAvailableAt));
  }, [storageKey]);

  const applyServerCooldown = useCallback(
    (payload?: ResendCooldownPayload | null) => {
      if (!payload) return;
      const serverRemaining = Math.max(0, Math.ceil(Number(payload.remainingSeconds || 0)));
      const nextAvailableAt =
        serverRemaining > 0
          ? payload.nextAvailableAt || new Date(Date.now() + serverRemaining * 1000).toISOString()
          : null;
      const nextState: PersistedCooldownState = {
        attemptCount: Math.max(0, Math.floor(Number(payload.attemptCount || 0))),
        cooldownSeconds:
          serverRemaining > 0
            ? Math.max(serverRemaining, Math.ceil(Number(payload.cooldownSeconds || 0)))
            : 0,
        nextAvailableAt,
        blockedByIp: Boolean(payload.blockedByIp && serverRemaining > 0),
      };
      writePersistedCooldown(storageKey, nextState);
      setState(nextState);
      setRemainingSeconds(computeRemainingSeconds(nextState.nextAvailableAt));
    },
    [storageKey]
  );

  const clearCooldown = useCallback(() => {
    const emptyState: PersistedCooldownState = {
      attemptCount: 0,
      cooldownSeconds: 0,
      nextAvailableAt: null,
      blockedByIp: false,
    };
    writePersistedCooldown(storageKey, null);
    setState(emptyState);
    setRemainingSeconds(0);
  }, [storageKey]);

  // Hydrate persisted state from backend across reloads/sessions/devices
  const syncWithBackend = useCallback(async () => {
    if (!enabled || !normalizedEmail) return;
    try {
      const snapshot = await api.auth.getResendStatus(flow, normalizedEmail);
      if (!snapshot) return;
      if (snapshot.remainingSeconds > 0 || snapshot.attemptCount > 0) {
        applyServerCooldown(snapshot);
      } else {
        clearCooldown();
      }
    } catch {
      // Fall back to local cache gracefully if offline/unreachable
    }
  }, [enabled, flow, normalizedEmail, applyServerCooldown, clearCooldown]);

  useEffect(() => {
    void syncWithBackend();
  }, [syncWithBackend]);

  // Live 1s countdown computed against absolute expiration timestamp
  useEffect(() => {
    if (!state.nextAvailableAt) {
      setRemainingSeconds(0);
      return;
    }

    const updateTick = () => {
      const nextRemaining = computeRemainingSeconds(state.nextAvailableAt);
      setRemainingSeconds(nextRemaining);
      if (nextRemaining <= 0) {
        setState((prev) => {
          if (!prev.nextAvailableAt) return prev;
          const updated: PersistedCooldownState = {
            ...prev,
            cooldownSeconds: 0,
            nextAvailableAt: null,
            blockedByIp: false,
          };
          writePersistedCooldown(storageKey, updated);
          return updated;
        });
      }
    };

    updateTick();
    const timer = window.setInterval(updateTick, 1000);
    return () => window.clearInterval(timer);
  }, [state.nextAvailableAt, storageKey]);

  // Multi-tab and visibility synchronization
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== storageKey) return;
      const synced = readPersistedCooldown(storageKey) || {
        attemptCount: 0,
        cooldownSeconds: 0,
        nextAvailableAt: null,
        blockedByIp: false,
      };
      setState(synced);
      setRemainingSeconds(computeRemainingSeconds(synced.nextAvailableAt));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const currentRemaining = computeRemainingSeconds(state.nextAvailableAt);
        setRemainingSeconds(currentRemaining);
        void syncWithBackend();
      }
    };

    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [storageKey, state.nextAvailableAt, syncWithBackend]);

  const isInCooldown = remainingSeconds > 0;
  const formattedCountdown = formatCountdownMMSS(remainingSeconds);
  const nextAvailableTimeLabel = formatNextAvailableClock(state.nextAvailableAt, remainingSeconds);

  return {
    attemptCount: state.attemptCount,
    cooldownSeconds: state.cooldownSeconds,
    remainingSeconds,
    formattedCountdown,
    nextAvailableAt: state.nextAvailableAt,
    nextAvailableTimeLabel,
    isInCooldown,
    blockedByIp: Boolean(state.blockedByIp && isInCooldown),
    applyServerCooldown,
    clearCooldown,
    syncWithBackend,
  };
}
