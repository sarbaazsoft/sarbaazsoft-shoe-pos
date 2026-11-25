import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UnsavedChangesModal } from '../components/common/UnsavedChangesModal.tsx';

export interface UnsavedScopeConfig {
  label: string;
  isDirty: boolean;
  isActive?: boolean;
  save: () => Promise<boolean> | boolean;
  discard: () => Promise<void> | void;
}

export interface UnsavedScopeMeta {
  scopeId: string;
  label: string;
  isDirty: boolean;
  isActive: boolean;
}

export interface NavigationGuardOptions {
  scopeIds?: string[];
  activeOnly?: boolean;
}

interface UnsavedScopeRecord {
  scopeId: string;
  label: string;
  isDirty: boolean;
  isActive: boolean;
  save: () => Promise<boolean> | boolean;
  discard: () => Promise<void> | void;
}

export interface UnsavedChangesContextValue {
  dirtyScopes: Record<string, boolean>;
  hasUnsavedChanges: boolean;
  isDialogOpen: boolean;
  isScopeDirty: (scopeId: string) => boolean;
  hasDirtyMatchingScopes: (options?: NavigationGuardOptions) => boolean;
  registerScope: (scopeId: string, config: UnsavedScopeConfig) => void;
  unregisterScope: (scopeId: string) => void;
  requestNavigation: (
    onProceed: () => void | Promise<void>,
    options?: NavigationGuardOptions
  ) => Promise<boolean>;
}

/**
 * Pure helper to determine which registered scopes block navigation.
 */
export function resolveTargetDirtyScopes<T extends UnsavedScopeMeta>(
  entries: T[],
  options?: NavigationGuardOptions
): T[] {
  const scopeIdSet =
    options?.scopeIds && options.scopeIds.length > 0 ? new Set(options.scopeIds) : null;
  const activeOnly = options?.activeOnly !== false;

  return entries.filter((entry) => {
    if (!entry.isDirty) return false;
    if (scopeIdSet && !scopeIdSet.has(entry.scopeId)) return false;
    if (activeOnly && !entry.isActive) return false;
    return true;
  });
}

/**
 * Pure helper to execute a "Save & Continue" sequence across dirty scopes.
 * Halts immediately and returns `{ ok: false, error }` if any save returns false or throws.
 */
export async function executeSaveScopesAndProceed(
  scopes: Array<{ label: string; save: () => Promise<boolean> | boolean }>,
  onProceed: () => void | Promise<void>
): Promise<{ ok: boolean; error?: string }> {
  for (const scope of scopes) {
    try {
      const saved = await Promise.resolve(scope.save());
      if (!saved) {
        return {
          ok: false,
          error: `Could not save ${scope.label}. Please resolve any errors above before leaving.`,
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || `Failed to save ${scope.label}. Please review and try again.`,
      };
    }
  }

  await Promise.resolve(onProceed());
  return { ok: true };
}

/**
 * Pure helper to compare two plain snapshots/records stably.
 */
export function areSnapshotsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!areSnapshotsEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined);
  const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!areSnapshotsEqual(objA[key], objB[key])) return false;
  }
  return true;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue>({
  dirtyScopes: {},
  hasUnsavedChanges: false,
  isDialogOpen: false,
  isScopeDirty: () => false,
  hasDirtyMatchingScopes: () => false,
  registerScope: () => {},
  unregisterScope: () => {},
  requestNavigation: async (onProceed) => {
    await Promise.resolve(onProceed());
    return true;
  },
});

interface PendingNavigationPrompt {
  targets: UnsavedScopeRecord[];
  onProceed: () => void | Promise<void>;
  resolve: (proceeded: boolean) => void;
}

export const UnsavedChangesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const scopesRef = useRef<Map<string, UnsavedScopeRecord>>(new Map());
  const [dirtyScopes, setDirtyScopes] = useState<Record<string, boolean>>({});
  const [pendingPrompt, setPendingPrompt] = useState<PendingNavigationPrompt | null>(null);
  const pendingPromptRef = useRef<PendingNavigationPrompt | null>(null);
  const [isSavingFromModal, setIsSavingFromModal] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  pendingPromptRef.current = pendingPrompt;

  const syncDirtySnapshot = useCallback(() => {
    const nextDirty: Record<string, boolean> = {};
    scopesRef.current.forEach((record, key) => {
      if (record.isDirty && record.isActive) {
        nextDirty[key] = true;
      }
    });

    setDirtyScopes((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(nextDirty);
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === nextDirty[k])) {
        return prev;
      }
      return nextDirty;
    });
  }, []);

  const registerScope = useCallback(
    (scopeId: string, config: UnsavedScopeConfig) => {
      const isActive = config.isActive !== false;
      const existing = scopesRef.current.get(scopeId);
      const nextRecord: UnsavedScopeRecord = {
        scopeId,
        label: config.label,
        isDirty: Boolean(config.isDirty),
        isActive,
        save: config.save,
        discard: config.discard,
      };
      scopesRef.current.set(scopeId, nextRecord);

      if (
        !existing ||
        existing.isDirty !== nextRecord.isDirty ||
        existing.isActive !== nextRecord.isActive
      ) {
        syncDirtySnapshot();
      }
    },
    [syncDirtySnapshot]
  );

  const unregisterScope = useCallback(
    (scopeId: string) => {
      if (scopesRef.current.delete(scopeId)) {
        syncDirtySnapshot();
      }
    },
    [syncDirtySnapshot]
  );

  const isScopeDirty = useCallback(
    (scopeId: string) => {
      const rec = scopesRef.current.get(scopeId);
      return Boolean(rec?.isDirty && rec?.isActive);
    },
    []
  );

  const hasDirtyMatchingScopes = useCallback((options?: NavigationGuardOptions) => {
    const entries = Array.from(scopesRef.current.values());
    return resolveTargetDirtyScopes(entries, options).length > 0;
  }, []);

  const requestNavigation = useCallback(
    (
      onProceed: () => void | Promise<void>,
      options?: NavigationGuardOptions
    ): Promise<boolean> => {
      if (pendingPromptRef.current) {
        return Promise.resolve(false);
      }

      const entries = Array.from(scopesRef.current.values());
      const targets = resolveTargetDirtyScopes(entries, options);
      if (targets.length === 0) {
        return Promise.resolve(onProceed()).then(() => true);
      }

      setModalError(null);
      setIsSavingFromModal(false);

      return new Promise<boolean>((resolve) => {
        const promptState: PendingNavigationPrompt = {
          targets,
          onProceed,
          resolve,
        };
        pendingPromptRef.current = promptState;
        setPendingPrompt(promptState);
      });
    },
    []
  );

  const handleStay = useCallback(() => {
    if (isSavingFromModal) return;
    const current = pendingPromptRef.current;
    if (!current) return;
    pendingPromptRef.current = null;
    setPendingPrompt(null);
    setModalError(null);
    current.resolve(false);
  }, [isSavingFromModal]);

  const handleDiscardAndContinue = useCallback(async () => {
    if (isSavingFromModal) return;
    const current = pendingPromptRef.current;
    if (!current) return;

    for (const target of current.targets) {
      const liveScope = scopesRef.current.get(target.scopeId) || target;
      await Promise.resolve(liveScope.discard());
    }

    pendingPromptRef.current = null;
    setPendingPrompt(null);
    setModalError(null);
    syncDirtySnapshot();

    await Promise.resolve(current.onProceed());
    current.resolve(true);
  }, [isSavingFromModal, syncDirtySnapshot]);

  const handleSaveAndContinue = useCallback(async () => {
    if (isSavingFromModal) return;
    const current = pendingPromptRef.current;
    if (!current) return;

    setIsSavingFromModal(true);
    setModalError(null);

    const liveTargets = current.targets.map(
      (target) => scopesRef.current.get(target.scopeId) || target
    );

    const result = await executeSaveScopesAndProceed(liveTargets, async () => {
      pendingPromptRef.current = null;
      setPendingPrompt(null);
      syncDirtySnapshot();
      await Promise.resolve(current.onProceed());
      current.resolve(true);
    });

    setIsSavingFromModal(false);

    if (!result.ok) {
      setModalError(
        result.error || 'Could not save changes. Please verify your entries and try again.'
      );
    }
  }, [isSavingFromModal, syncDirtySnapshot]);

  const hasUnsavedChanges = useMemo(
    () => Object.values(dirtyScopes).some(Boolean),
    [dirtyScopes]
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const contextValue = useMemo<UnsavedChangesContextValue>(
    () => ({
      dirtyScopes,
      hasUnsavedChanges,
      isDialogOpen: Boolean(pendingPrompt),
      isScopeDirty,
      hasDirtyMatchingScopes,
      registerScope,
      unregisterScope,
      requestNavigation,
    }),
    [
      dirtyScopes,
      hasUnsavedChanges,
      pendingPrompt,
      isScopeDirty,
      hasDirtyMatchingScopes,
      registerScope,
      unregisterScope,
      requestNavigation,
    ]
  );

  return (
    <UnsavedChangesContext.Provider value={contextValue}>
      {children}
      <UnsavedChangesModal
        isOpen={Boolean(pendingPrompt)}
        sectionLabels={pendingPrompt?.targets.map((t) => t.label) || []}
        isSaving={isSavingFromModal}
        saveError={modalError}
        onSaveChanges={() => void handleSaveAndContinue()}
        onDiscardChanges={() => void handleDiscardAndContinue()}
        onStay={handleStay}
      />
    </UnsavedChangesContext.Provider>
  );
};

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}

/**
 * Registers an independent unsaved-changes scope for a Settings section/tab.
 * Stores save/discard callbacks in refs so callers always execute the latest closure state.
 */
export function useRegisterUnsavedScope(scopeId: string, config: UnsavedScopeConfig) {
  const { registerScope, unregisterScope } = useUnsavedChanges();
  const latestConfigRef = useRef(config);
  latestConfigRef.current = config;

  const isActive = config.isActive !== false;

  useEffect(() => {
    registerScope(scopeId, {
      label: config.label,
      isDirty: config.isDirty,
      isActive,
      save: () => latestConfigRef.current.save(),
      discard: () => latestConfigRef.current.discard(),
    });
  }, [scopeId, config.label, config.isDirty, isActive, registerScope]);

  useEffect(() => {
    return () => {
      unregisterScope(scopeId);
    };
  }, [scopeId, unregisterScope]);
}
