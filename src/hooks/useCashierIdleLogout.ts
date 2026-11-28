import { useState, useEffect, useRef, useCallback } from 'react';
import {
  CASHIER_ACTIVITY_STORAGE_KEY,
  DEFAULT_CASHIER_IDLE_TIMEOUT_MS,
  DEFAULT_CASHIER_WARNING_DURATION_MS,
  evaluateIdleState,
} from '../utils/cashierIdleTimer.ts';

interface UseCashierIdleLogoutOptions {
  enabled: boolean;
  onAutoLogout: () => void;
  idleTimeoutMs?: number;
  warningDurationMs?: number;
}

interface UseCashierIdleLogoutResult {
  isWarningOpen: boolean;
  remainingSeconds: number;
  totalWarningSeconds: number;
  staySignedIn: () => void;
  logoutNow: () => void;
}

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'pointerdown',
  'mousedown',
  'keydown',
  'touchstart',
  'mousemove',
  'wheel',
  'scroll',
];

const IMMEDIATE_EVENTS = new Set<string>(['pointerdown', 'mousedown', 'keydown', 'touchstart']);

export function useCashierIdleLogout({
  warningDurationMs = DEFAULT_CASHIER_WARNING_DURATION_MS,
}: UseCashierIdleLogoutOptions): UseCashierIdleLogoutResult {
  const totalWarningSeconds = Math.max(1, Math.ceil(warningDurationMs / 1000));

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(CASHIER_ACTIVITY_STORAGE_KEY);
    } catch {}
  }, []);

  const noop = useCallback(() => {}, []);

  return {
    isWarningOpen: false,
    remainingSeconds: totalWarningSeconds,
    totalWarningSeconds,
    staySignedIn: noop,
    logoutNow: noop,
  };
}
