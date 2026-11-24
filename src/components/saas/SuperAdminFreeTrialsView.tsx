import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  Store,
  Plus,
  Search,
  RefreshCw,
  Eye,
  Pencil,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  PlayCircle,
  History,
  User,
  Mail,
  Phone,
  Calendar,
  AlertTriangle,
  AlertCircle,
  X,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  TrialActivation,
  TrialTrackingHistoryEntry,
  FreeTrialSummary,
} from '../../types';

interface SuperAdminFreeTrialsViewProps {
  storesCount: number;
  initialTrials?: TrialActivation[];
  onOpenStore: (tenantId: number) => void;
  onGoToStores: () => void;
  onOpenCreateStore: () => void;
  onDataChanged: () => void;
  onSuccessMessage?: (msg: string) => void;
  onErrorMessage?: (msg: string) => void;
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CONVERTED' | 'PENDING';
type ViewMode = 'TRIALS' | 'HISTORY';
type HistoryFilter =
  | 'ALL'
  | 'EXPIRED_CONVERTED_SUSPENDED'
  | 'EXPIRED'
  | 'CONVERTED'
  | 'SUSPENDED'
  | 'REACTIVATED'
  | 'EXTENDED'
  | 'ACTIVATED'
  | 'EDITED';

const formatDateShort = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDateTimeShort = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const toDateInputValue = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

export const SuperAdminFreeTrialsView: React.FC<SuperAdminFreeTrialsViewProps> = ({
  storesCount,
  initialTrials = [],
  onOpenStore,
  onGoToStores,
  onOpenCreateStore,
  onDataChanged,
  onSuccessMessage,
  onErrorMessage,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('TRIALS');
  const [trials, setTrials] = useState<TrialActivation[]>(initialTrials);
  const [history, setHistory] = useState<TrialTrackingHistoryEntry[]>([]);
  const [summary, setSummary] = useState<FreeTrialSummary>({
    totalTrials: initialTrials.length,
    activeTrials: 0,
    expiredTrials: 0,
    suspendedTrials: 0,
    convertedTrials: 0,
    pendingTrials: 0,
    todayTrials: 0,
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL');

  // View Modal + per-trial history
  const [viewingTrial, setViewingTrial] = useState<TrialActivation | null>(null);
  const [viewingHistory, setViewingHistory] = useState<TrialTrackingHistoryEntry[]>([]);
  const [loadingViewingHistory, setLoadingViewingHistory] = useState(false);

  // Edit Modal
  const [editingTrial, setEditingTrial] = useState<TrialActivation | null>(null);
  const [editStoreName, setEditStoreName] = useState('');
  const [editUserName, setEditUserName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBusinessType, setEditBusinessType] = useState<'RETAIL' | 'WHOLESALE'>('RETAIL');
  const [editPricingMode, setEditPricingMode] = useState<'FIXED' | 'NEGOTIABLE'>('FIXED');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editStatus, setEditStatus] = useState<'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CONVERTED' | 'PENDING'>('ACTIVE');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Extend Modal (Custom days / quick extend)
  const [extendingTrialModal, setExtendingTrialModal] = useState<TrialActivation | null>(null);
  const [extendDaysInput, setExtendDaysInput] = useState<number>(30);
  const [extendNotesInput, setExtendNotesInput] = useState('');

  // Permanent Delete Confirmation Modal
  const [deletingTrial, setDeletingTrial] = useState<TrialActivation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const notifySuccess = useCallback(
    (msg: string) => {
      setLocalError(null);
      setLocalSuccess(msg);
      onSuccessMessage?.(msg);
    },
    [onSuccessMessage]
  );

  const notifyError = useCallback(
    (msg: string) => {
      setLocalSuccess(null);
      setLocalError(msg);
      onErrorMessage?.(msg);
    },
    [onErrorMessage]
  );

  const loadFreeTrialsData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.superAdmin.getFreeTrials();
      if (Array.isArray(res?.trials)) {
        setTrials(res.trials);
      }
      if (Array.isArray(res?.history)) {
        setHistory(res.history);
      }
      if (res?.summary) {
        setSummary(res.summary);
      }
    } catch (err: any) {
      notifyError(err?.message || 'Failed to load free trial management data.');
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    void loadFreeTrialsData();
  }, [loadFreeTrialsData]);

  const filteredTrials = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return trials.filter((t) => {
      if (statusFilter !== 'ALL' && String(t.status).toUpperCase() !== statusFilter) {
        return false;
      }
      if (!needle) return true;
      return (
        String(t.storeName || '').toLowerCase().includes(needle) ||
        String(t.userName || '').toLowerCase().includes(needle) ||
        String(t.email || '').toLowerCase().includes(needle) ||
        String(t.phone || '').toLowerCase().includes(needle) ||
        String(t.tenantId || '').includes(needle)
      );
    });
  }, [trials, statusFilter, searchQuery]);

  const filteredHistory = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return history.filter((h) => {
      const ev = String(h.eventType || '').toUpperCase();
      if (historyFilter === 'EXPIRED_CONVERTED_SUSPENDED') {
        if (!['EXPIRED', 'CONVERTED', 'SUSPENDED'].includes(ev)) return false;
      } else if (historyFilter !== 'ALL' && ev !== historyFilter) {
        return false;
      }
      if (!needle) return true;
      return (
        String(h.storeName || '').toLowerCase().includes(needle) ||
        String(h.ownerName || '').toLowerCase().includes(needle) ||
        String(h.ownerEmail || '').toLowerCase().includes(needle) ||
        String(h.notes || '').toLowerCase().includes(needle) ||
        String(h.tenantId || '').includes(needle)
      );
    });
  }, [history, historyFilter, searchQuery]);

  const handleOpenViewModal = async (trial: TrialActivation) => {
    setViewingTrial(trial);
    setViewingHistory([]);
    setLoadingViewingHistory(true);
    try {
      const res = await api.superAdmin.getFreeTrialHistory(trial.id);
      if (Array.isArray(res?.history)) {
        setViewingHistory(res.history);
      }
    } catch {
      setViewingHistory([]);
    } finally {
      setLoadingViewingHistory(false);
    }
  };

  const handleOpenEditModal = (trial: TrialActivation) => {
    setEditingTrial(trial);
    setEditStoreName(trial.storeName || '');
    setEditUserName(trial.userName || '');
    setEditEmail(trial.email || '');
    setEditPhone(trial.phone || '');
    setEditBusinessType(
      String(trial.businessType || 'RETAIL').toUpperCase() === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL'
    );
    setEditPricingMode(
      String(trial.pricingMode || 'FIXED').toUpperCase() === 'NEGOTIABLE' ? 'NEGOTIABLE' : 'FIXED'
    );
    setEditStartDate(toDateInputValue(trial.trialStartDate));
    setEditEndDate(toDateInputValue(trial.trialEndDate));
    setEditStatus(
      (['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CONVERTED', 'PENDING'].includes(String(trial.status).toUpperCase())
        ? String(trial.status).toUpperCase()
        : 'ACTIVE') as 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CONVERTED' | 'PENDING'
    );
    setEditNotes('');
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrial) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await api.superAdmin.updateFreeTrial(editingTrial.id, {
        storeName: editStoreName.trim(),
        userName: editUserName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
        businessType: editBusinessType,
        pricingMode: editBusinessType === 'WHOLESALE' ? 'FIXED' : editPricingMode,
        trialStartDate: editStartDate || undefined,
        trialEndDate: editEndDate || undefined,
        status: editStatus,
        notes: editNotes.trim() || undefined,
      });
      notifySuccess(res.message || `Updated free trial store '${editStoreName}'.`);
      setEditingTrial(null);
      await loadFreeTrialsData();
      onDataChanged();
    } catch (err: any) {
      setEditError(err?.message || 'Failed to save changes.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleExtendSubmit = async (trialId: number, days: number, notes?: string) => {
    setBusyId(trialId);
    try {
      const res = await api.superAdmin.extendFreeTrial(trialId, days, notes);
      notifySuccess(res.message || `Extended trial by ${days} days.`);
      setExtendingTrialModal(null);
      setExtendNotesInput('');
      await loadFreeTrialsData();
      onDataChanged();
    } catch (err: any) {
      notifyError(err?.message || 'Failed to extend free trial.');
    } finally {
      setBusyId(null);
    }
  };

  const handleExpireTrial = async (trial: TrialActivation) => {
    setBusyId(trial.id);
    try {
      const res = await api.superAdmin.expireFreeTrial(trial.id);
      notifySuccess(res.message || `Trial '${trial.storeName}' marked as expired.`);
      await loadFreeTrialsData();
      onDataChanged();
    } catch (err: any) {
      notifyError(err?.message || 'Failed to expire free trial.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSuspendTrial = async (trial: TrialActivation) => {
    setBusyId(trial.id);
    try {
      const res = await api.superAdmin.suspendFreeTrial(trial.id);
      notifySuccess(res.message || `Trial '${trial.storeName}' suspended.`);
      await loadFreeTrialsData();
      onDataChanged();
    } catch (err: any) {
      notifyError(err?.message || 'Failed to suspend free trial.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReactivateTrial = async (trial: TrialActivation, days?: number) => {
    setBusyId(trial.id);
    try {
      const res = await api.superAdmin.reactivateFreeTrial(trial.id, days);
      notifySuccess(res.message || `Trial '${trial.storeName}' reactivated.`);
      await loadFreeTrialsData();
      onDataChanged();
    } catch (err: any) {
      notifyError(err?.message || 'Failed to reactivate free trial.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingTrial) return;
    setIsDeleting(true);
    try {
      const res = await api.superAdmin.deleteFreeTrial(deletingTrial.id);
      notifySuccess(
        res.message ||
          `Permanently deleted '${deletingTrial.storeName}' and all trial history, tracking records, and activity logs.`
      );
      if (viewingTrial?.id === deletingTrial.id) {
        setViewingTrial(null);
      }
      setDeletingTrial(null);
      await loadFreeTrialsData();
      onDataChanged();
    } catch (err: any) {
      notifyError(err?.message || 'Failed to permanently delete free trial store.');
    } finally {
      setIsDeleting(false);
    }
  };

  const renderStatusBadge = (status: string) => {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'EXPIRED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold font-mono bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          EXPIRED
        </span>
      );
    }
    if (s === 'SUSPENDED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold font-mono bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          SUSPENDED
        </span>
      );
    }
    if (s === 'CONVERTED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold font-mono bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/60">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          CONVERTED
        </span>
      );
    }
    if (s === 'PENDING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold font-mono bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          PENDING VERIFY
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold font-mono bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        ACTIVE
      </span>
    );
  };

  const renderEventBadge = (eventType: string) => {
    const ev = String(eventType || 'EDITED').toUpperCase();
    const tone =
      ev === 'EXPIRED'
        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60'
        : ev === 'SUSPENDED'
        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
        : ev === 'CONVERTED'
        ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700/60'
        : ev === 'REACTIVATED' || ev === 'EXTENDED' || ev === 'EMAIL_VERIFIED' || ev === 'ACTIVATED'
        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
        : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800/60';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold font-mono border ${tone}`}>
        {ev}
      </span>
    );
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto text-xs select-none">
      {/* Top Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-gradient-to-r dark:from-purple-900 dark:via-indigo-950 dark:to-slate-900 p-3.5 sm:p-5 rounded-2xl border border-slate-200 dark:border-purple-800/80 shadow-sm transition-colors dark:text-white"
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40 font-mono mb-2">
            <ShieldCheck className="w-3 h-3" />
            <span>SuperAdmin Full Override Enabled</span>
          </div>
          <h2 className="text-lg sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Free Trial Management &amp; Tracking History
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-purple-200/80 font-medium mt-0.5">
            Inspect, edit, extend, expire, suspend, reactivate &amp; permanently delete trial stores • Unfettered SuperAdmin store access
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={onGoToStores}
            className="bg-[#0284C7] hover:bg-[#0369A1] dark:bg-purple-500/20 dark:hover:bg-purple-500/30 text-white dark:text-purple-200 border border-[#0284C7] dark:border-purple-400/40 shadow-sm font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs flex items-center space-x-1.5 sm:space-x-2 transition-all cursor-pointer"
          >
            <Store className="w-4 h-4" />
            <span>Deployed Stores ({storesCount})</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreateStore}
            className="bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 text-white border border-purple-400/40 shadow-md shadow-purple-600/25 font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs flex items-center space-x-1.5 transition-all cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add Trial Store</span>
          </button>
        </div>
      </motion.div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        {[
          {
            label: 'Total Free Trials',
            val: summary.totalTrials,
            icon: Sparkles,
            tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-700/40',
            filter: 'ALL' as StatusFilter,
          },
          {
            label: 'Active Trials',
            val: summary.activeTrials,
            icon: CheckCircle2,
            tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700/40',
            filter: 'ACTIVE' as StatusFilter,
          },
          {
            label: 'Expired Trials',
            val: summary.expiredTrials,
            icon: XCircle,
            tone: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700/40',
            filter: 'EXPIRED' as StatusFilter,
          },
          {
            label: 'Suspended Trials',
            val: summary.suspendedTrials,
            icon: PauseCircle,
            tone: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-700/40',
            filter: 'SUSPENDED' as StatusFilter,
          },
          {
            label: 'Converted to Paid',
            val: summary.convertedTrials,
            icon: TrendingUp,
            tone: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-700/40',
            filter: 'CONVERTED' as StatusFilter,
          },
        ].map((card) => {
          const Icon = card.icon;
          const isSelected = viewMode === 'TRIALS' && statusFilter === card.filter;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => {
                setViewMode('TRIALS');
                setStatusFilter(card.filter);
              }}
              className={`app-card p-3 sm:p-3.5 text-left transition cursor-pointer flex items-center justify-between gap-2 ${
                isSelected ? 'ring-2 ring-purple-500/70 dark:ring-purple-400/70' : 'hover:border-purple-300 dark:hover:border-purple-600/60'
              }`}
            >
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 truncate">
                  {card.label}
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-0.5 font-mono">
                  {card.val}
                </div>
              </div>
              <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${card.tone}`}>
                <Icon className="w-4.5 h-4.5" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Inline Feedback Banners */}
      {localError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{localError}</span>
          </div>
          <button type="button" onClick={() => setLocalError(null)} className="p-1 hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {localSuccess && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{localSuccess}</span>
          </div>
          <button type="button" onClick={() => setLocalSuccess(null)} className="p-1 hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search, View Switch & Status Filters */}
      <div className="app-card p-3 sm:p-4 space-y-3 transition-colors dark:bg-gradient-to-r dark:from-purple-900 dark:via-indigo-950 dark:to-slate-900 dark:border-purple-800/80 dark:text-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Mode Tabs: Trial Stores vs Tracking History */}
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-900/90 p-1 border border-slate-200 dark:border-purple-800/60">
            <button
              type="button"
              onClick={() => setViewMode('TRIALS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'TRIALS'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Trial Stores ({trials.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('HISTORY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'HISTORY'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Tracking History ({history.length})</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px] justify-end">
            <div className="relative flex-1 max-w-md min-w-[200px]">
              <Search className="w-4 h-4 text-purple-600 dark:text-purple-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by store, owner name, email, phone, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="app-input w-full pl-[2.125rem] pr-8 py-2 text-xs font-medium dark:bg-slate-900/80 dark:border-purple-800/60 dark:text-white dark:placeholder-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-purple-600 hover:text-purple-800 dark:text-purple-400 p-1 cursor-pointer"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => void loadFreeTrialsData()}
              disabled={loading}
              className="btn-outline-landing flex items-center space-x-1.5 px-3 py-2 bg-slate-100 dark:bg-purple-500/20 hover:bg-slate-200 dark:hover:bg-purple-500/30 text-slate-700 dark:text-purple-200 border border-slate-200 dark:border-purple-400/40 font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter Chips */}
        {viewMode === 'TRIALS' ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-purple-800/40">
            {(['ALL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CONVERTED', 'PENDING'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setStatusFilter(opt)}
                className={`px-3 py-1.5 rounded-lg font-bold border transition cursor-pointer text-[11px] ${
                  statusFilter === opt
                    ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white border-purple-400/50 shadow-sm'
                    : 'bg-slate-50 dark:bg-purple-500/15 text-slate-700 dark:text-purple-200 border-slate-200 dark:border-purple-400/30 hover:bg-slate-100 dark:hover:bg-purple-500/25'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-purple-800/40">
            {(
              [
                { id: 'ALL', label: 'All Events' },
                { id: 'EXPIRED_CONVERTED_SUSPENDED', label: 'Expired / Converted / Suspended' },
                { id: 'EXPIRED', label: 'Expired' },
                { id: 'CONVERTED', label: 'Converted' },
                { id: 'SUSPENDED', label: 'Suspended' },
                { id: 'REACTIVATED', label: 'Reactivated' },
                { id: 'EXTENDED', label: 'Extended' },
                { id: 'ACTIVATED', label: 'Activated' },
                { id: 'EDITED', label: 'Edited' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setHistoryFilter(opt.id)}
                className={`px-2.5 py-1.5 rounded-lg font-bold border transition cursor-pointer text-[11px] ${
                  historyFilter === opt.id
                    ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white border-purple-400/50 shadow-sm'
                    : 'bg-slate-50 dark:bg-purple-500/15 text-slate-700 dark:text-purple-200 border-slate-200 dark:border-purple-400/30 hover:bg-slate-100 dark:hover:bg-purple-500/25'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Content: Trial Stores Directory */}
      {viewMode === 'TRIALS' && (
        <div className="app-card overflow-hidden transition-colors dark:border-purple-800/60">
          {/* Mobile Stacked Cards */}
          <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
            {loading && filteredTrials.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-500 mx-auto mb-2" />
                <p>Loading trial stores...</p>
              </div>
            ) : filteredTrials.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                No free trial stores match your filter.
              </div>
            ) : (
              filteredTrials.map((trial) => {
                const statusUpper = String(trial.status || 'ACTIVE').toUpperCase();
                const isBusy = busyId === trial.id;
                const daysLeft = trial.daysRemaining ?? 0;
                return (
                  <div key={`m-ft-${trial.id}`} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white font-black text-xs shrink-0">
                          {(trial.storeName || 'TS').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white text-sm truncate">
                            {trial.storeName}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                            {trial.userName} • {trial.email}
                          </div>
                          {trial.phone && (
                            <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
                              {trial.phone}
                            </div>
                          )}
                        </div>
                      </div>
                      {renderStatusBadge(statusUpper)}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40 font-bold">
                        TRIAL #{trial.id}
                      </span>
                      {trial.tenantId && (
                        <span className="px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/40 font-bold">
                          TENANT #{trial.tenantId}
                        </span>
                      )}
                      <span className="text-slate-600 dark:text-slate-300">
                        Start: {formatDateShort(trial.trialStartDate)} • End: {formatDateShort(trial.trialEndDate)}
                      </span>
                      {statusUpper === 'ACTIVE' && (
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          ({daysLeft}d left)
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleOpenViewModal(trial)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(trial)}
                        className="px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-700/50 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setExtendingTrialModal(trial);
                          setExtendDaysInput(30);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-purple-600 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Extend</span>
                      </button>
                      {(statusUpper === 'EXPIRED' || statusUpper === 'SUSPENDED' || statusUpper === 'PENDING') ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleReactivateTrial(trial, statusUpper === 'EXPIRED' ? 30 : undefined)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <PlayCircle className="w-3.5 h-3.5" />
                          <span>Reactivate</span>
                        </button>
                      ) : statusUpper === 'ACTIVE' ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSuspendTrial(trial)}
                            className="px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <PauseCircle className="w-3.5 h-3.5" />
                            <span>Suspend</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleExpireTrial(trial)}
                            className="px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Expire</span>
                          </button>
                        </>
                      ) : null}
                      {trial.tenantId && (
                        <button
                          type="button"
                          onClick={() => onOpenStore(trial.tenantId!)}
                          className="px-2.5 py-1.5 rounded-lg border border-sky-200 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Store className="w-3.5 h-3.5" />
                          <span>Open POS</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeletingTrial(trial)}
                        className="ml-auto px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-gradient-to-r dark:from-purple-900 dark:via-indigo-950 dark:to-slate-900 text-slate-700 dark:text-white font-bold border-b border-slate-200 dark:border-purple-800/80 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Store &amp; Mode</th>
                  <th className="py-3.5 px-3">Owner Details</th>
                  <th className="py-3.5 px-4">Trial Dates &amp; Window</th>
                  <th className="py-3.5 px-3 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Management Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {loading && filteredTrials.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin text-purple-500 mx-auto mb-2" />
                      Loading free trial stores...
                    </td>
                  </tr>
                ) : filteredTrials.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No free trial stores match your search or status filter.
                    </td>
                  </tr>
                ) : (
                  filteredTrials.map((trial) => {
                    const statusUpper = String(trial.status || 'ACTIVE').toUpperCase();
                    const isBusy = busyId === trial.id;
                    const daysLeft = trial.daysRemaining ?? 0;

                    return (
                      <tr key={trial.id} className="table-row-hover border-b border-slate-100 dark:border-slate-800/80">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white font-black text-xs shrink-0">
                              {(trial.storeName || 'TS').slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white text-sm">
                                {trial.storeName}
                              </div>
                              <div className="mt-1 flex items-center gap-1 flex-wrap font-mono text-[10px]">
                                <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40 font-bold">
                                  TRIAL #{trial.id}
                                </span>
                                {trial.tenantId && (
                                  <span className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/40 font-bold">
                                    TENANT #{trial.tenantId}
                                  </span>
                                )}
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  {String(trial.businessType || 'RETAIL').toUpperCase() === 'WHOLESALE' ? 'Wholesale' : 'Retail'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                            <span>{trial.userName || 'Store Owner'}</span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mt-0.5">
                            <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{trial.email}</span>
                          </div>
                          {trial.phone && (
                            <div className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                              <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>{trial.phone}</span>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 font-mono">
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            Start: <strong>{formatDateShort(trial.trialStartDate)}</strong> ({trial.trialDurationDays || 30}d)
                          </div>
                          <div className="text-[11px] text-slate-700 dark:text-slate-200 mt-0.5">
                            End: <strong>{formatDateShort(trial.trialEndDate)}</strong>
                          </div>
                          <div className="mt-1">
                            {statusUpper === 'CONVERTED' ? (
                              <span className="text-[10.5px] font-bold text-purple-600 dark:text-purple-300">
                                Converted {trial.convertedPlan ? `(${trial.convertedPlan})` : ''}
                              </span>
                            ) : statusUpper === 'SUSPENDED' ? (
                              <span className="text-[10.5px] font-bold text-amber-600 dark:text-amber-400">
                                Suspended (SuperAdmin can open POS)
                              </span>
                            ) : statusUpper === 'EXPIRED' ? (
                              <span className="text-[10.5px] font-bold text-rose-600 dark:text-rose-400">
                                Expired (SuperAdmin can open POS)
                              </span>
                            ) : (
                              <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400">
                                {daysLeft} day{daysLeft === 1 ? '' : 's'} remaining
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          {renderStatusBadge(statusUpper)}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleOpenViewModal(trial)}
                              title="View details & trial tracking history"
                              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(trial)}
                              title="Edit trial store, owner & dates"
                              className="px-2 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-700/50 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-600 hover:text-white text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1 cursor-pointer transition"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setExtendingTrialModal(trial);
                                setExtendDaysInput(30);
                              }}
                              title="Extend trial window"
                              className="px-2 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>Extend</span>
                            </button>

                            {(statusUpper === 'EXPIRED' || statusUpper === 'SUSPENDED' || statusUpper === 'PENDING') ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleReactivateTrial(trial, statusUpper === 'EXPIRED' ? 30 : undefined)}
                                title="Reactivate trial store"
                                className="px-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <PlayCircle className="w-3.5 h-3.5" />
                                <span>Reactivate</span>
                              </button>
                            ) : statusUpper === 'ACTIVE' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleSuspendTrial(trial)}
                                  title="Suspend trial store"
                                  className="px-2 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-600 hover:text-white text-amber-700 dark:text-amber-300 font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition"
                                >
                                  <PauseCircle className="w-3.5 h-3.5" />
                                  <span>Suspend</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleExpireTrial(trial)}
                                  title="Mark trial as expired"
                                  className="px-2 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-600 hover:text-white text-rose-700 dark:text-rose-300 font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Expire</span>
                                </button>
                              </>
                            ) : null}

                            {trial.tenantId && (
                              <button
                                type="button"
                                onClick={() => onOpenStore(trial.tenantId!)}
                                title="Open Store POS (SuperAdmin bypasses subscription locks)"
                                className="px-2 py-1.5 rounded-lg border border-sky-200 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-600 hover:text-white text-sky-700 dark:text-sky-300 font-bold inline-flex items-center gap-1 cursor-pointer transition"
                              >
                                <Store className="w-3.5 h-3.5" />
                                <span>Open POS</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setDeletingTrial(trial)}
                              title="Permanently delete store & all trial tracking history"
                              className="px-2 py-1.5 rounded-lg border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-600 hover:text-white text-rose-700 dark:text-rose-300 font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tracking History Ledger */}
      {viewMode === 'HISTORY' && (
        <div className="app-card overflow-hidden transition-colors dark:border-purple-800/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-gradient-to-r dark:from-purple-900 dark:via-indigo-950 dark:to-slate-900 text-slate-700 dark:text-white font-bold border-b border-slate-200 dark:border-purple-800/80 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-3">Event</th>
                  <th className="py-3.5 px-4">Store &amp; Owner</th>
                  <th className="py-3.5 px-3">Transition</th>
                  <th className="py-3.5 px-4">Notes &amp; Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {loading && filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin text-purple-500 mx-auto mb-2" />
                      Loading trial tracking history...
                    </td>
                  </tr>
                ) : filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No trial tracking history entries match the active filter.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((item) => (
                    <tr key={item.id} className="table-row-hover border-b border-slate-100 dark:border-slate-800/80">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatDateTimeShort(item.createdAt)}
                      </td>
                      <td className="py-3 px-3">{renderEventBadge(item.eventType)}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {item.storeName || `Trial #${item.trialId || item.tenantId || '—'}`}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {item.ownerName ? `${item.ownerName} • ` : ''}
                          {item.ownerEmail || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.previousStatus && (
                            <>
                              <span className="text-slate-500 dark:text-slate-400">{item.previousStatus}</span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                            </>
                          )}
                          <span className="font-bold text-slate-900 dark:text-white">{item.newStatus}</span>
                        </div>
                        {(item.previousEndDate || item.newEndDate) && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            End: {formatDateShort(item.newEndDate || item.previousEndDate)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-700 dark:text-slate-200">{item.notes || '—'}</div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          By: {item.actorRole || 'SYSTEM'}
                          {item.actorEmail ? ` (${item.actorEmail})` : ''}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW DETAILS & TRACKING TIMELINE MODAL */}
      {viewingTrial && (
        <div
          className="form-modal-theme fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center px-2 py-2.5 sm:px-3 sm:py-4 overflow-y-auto"
          onClick={() => setViewingTrial(null)}
        >
          <div
            className="app-card bg-white dark:bg-[#111827] border border-slate-200 dark:border-purple-800/70 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl text-slate-900 dark:text-white my-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                    {viewingTrial.storeName}
                  </h3>
                  {renderStatusBadge(viewingTrial.status)}
                </div>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  Trial #{viewingTrial.id} {viewingTrial.tenantId ? `• Tenant #${viewingTrial.tenantId}` : ''} • Activated {formatDateTimeShort(viewingTrial.activatedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingTrial(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="text-[10.5px] font-bold uppercase text-slate-400">Owner Details</div>
                <div className="font-bold text-sm">{viewingTrial.userName || '—'}</div>
                <div className="font-mono text-xs text-slate-600 dark:text-slate-300">{viewingTrial.email}</div>
                <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{viewingTrial.phone || 'No phone provided'}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1 font-mono">
                <div className="text-[10.5px] font-bold uppercase text-slate-400 font-sans">Trial Dates &amp; Lifecycle</div>
                <div className="text-xs">Start: <strong>{formatDateShort(viewingTrial.trialStartDate)}</strong></div>
                <div className="text-xs">End: <strong>{formatDateShort(viewingTrial.trialEndDate)}</strong> ({viewingTrial.trialDurationDays}d)</div>
                {viewingTrial.convertedAt && (
                  <div className="text-xs text-purple-600 dark:text-purple-300">
                    Converted: {formatDateShort(viewingTrial.convertedAt)} ({viewingTrial.convertedPlan})
                  </div>
                )}
                {viewingTrial.suspendedAt && (
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    Suspended: {formatDateShort(viewingTrial.suspendedAt)}
                  </div>
                )}
                {viewingTrial.expiredAt && (
                  <div className="text-xs text-rose-600 dark:text-rose-400">
                    Expired: {formatDateShort(viewingTrial.expiredAt)}
                  </div>
                )}
                {viewingTrial.reactivatedAt && (
                  <div className="text-xs text-emerald-600 dark:text-emerald-400">
                    Reactivated: {formatDateShort(viewingTrial.reactivatedAt)}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-purple-500" />
                  <span>Trial Tracking History</span>
                </h4>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto">
                {loadingViewingHistory ? (
                  <div className="p-6 text-center text-slate-400">Loading tracking history...</div>
                ) : viewingHistory.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">No tracking events logged yet.</div>
                ) : (
                  viewingHistory.map((h) => (
                    <div key={h.id} className="p-3 flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {renderEventBadge(h.eventType)}
                          <span className="font-mono text-[11px] font-bold">
                            {h.previousStatus ? `${h.previousStatus} → ` : ''}
                            {h.newStatus}
                          </span>
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300">{h.notes}</div>
                        <div className="text-[10px] font-mono text-slate-400">
                          Actor: {h.actorRole || 'SYSTEM'} {h.actorEmail ? `(${h.actorEmail})` : ''}
                        </div>
                      </div>
                      <div className="text-[10.5px] font-mono text-slate-400 shrink-0">
                        {formatDateTimeShort(h.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              {viewingTrial.tenantId ? (
                <button
                  type="button"
                  onClick={() => onOpenStore(viewingTrial.tenantId!)}
                  className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Store className="w-3.5 h-3.5" />
                  <span>Open Store POS (SuperAdmin Override)</span>
                </button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingTrial;
                    setViewingTrial(null);
                    handleOpenEditModal(target);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                >
                  Edit Trial
                </button>
                <button
                  type="button"
                  onClick={() => setViewingTrial(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT FREE TRIAL MODAL */}
      {editingTrial && (
        <div
          className="form-modal-theme fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center px-2 py-2.5 sm:px-3 sm:py-4 overflow-y-auto"
          onClick={() => !savingEdit && setEditingTrial(null)}
        >
          <div
            className="app-card bg-white dark:bg-[#111827] border border-slate-200 dark:border-purple-800/70 rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6 shadow-2xl text-slate-900 dark:text-white my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Edit Free Trial Store
                </h3>
                <p className="text-xs font-mono text-purple-600 dark:text-purple-300">
                  {editingTrial.storeName} (Trial #{editingTrial.id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => !savingEdit && setEditingTrial(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Store Name</label>
                  <input
                    type="text"
                    required
                    value={editStoreName}
                    onChange={(e) => setEditStoreName(e.target.value)}
                    className="app-input w-full px-3 py-2 text-xs font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Owner Name</label>
                  <input
                    type="text"
                    required
                    value={editUserName}
                    onChange={(e) => setEditUserName(e.target.value)}
                    className="app-input w-full px-3 py-2 text-xs font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Owner Email</label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="app-input w-full px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Owner Phone</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="app-input w-full px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Business Type</label>
                  <select
                    value={editBusinessType}
                    onChange={(e) => {
                      const val = e.target.value === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
                      setEditBusinessType(val);
                      if (val === 'WHOLESALE') setEditPricingMode('FIXED');
                    }}
                    className="app-input w-full px-3 py-2 text-xs font-semibold cursor-pointer"
                  >
                    <option value="RETAIL">Retail (B2C)</option>
                    <option value="WHOLESALE">Wholesale (B2B)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Pricing Mode</label>
                  <select
                    value={editBusinessType === 'WHOLESALE' ? 'FIXED' : editPricingMode}
                    disabled={editBusinessType === 'WHOLESALE'}
                    onChange={(e) => setEditPricingMode(e.target.value === 'NEGOTIABLE' ? 'NEGOTIABLE' : 'FIXED')}
                    className="app-input w-full px-3 py-2 text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    <option value="FIXED">Fixed Price</option>
                    <option value="NEGOTIABLE">Negotiable / Bargaining</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Trial Start Date</label>
                  <input
                    type="date"
                    required
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="app-input w-full px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Trial End Date</label>
                  <input
                    type="date"
                    required
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="app-input w-full px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Trial Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="app-input w-full px-3 py-2 text-xs font-semibold cursor-pointer"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="EXPIRED">EXPIRED</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="CONVERTED">CONVERTED</option>
                  <option value="PENDING">PENDING</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Audit Note (optional)</label>
                <input
                  type="text"
                  placeholder="Reason for adjustment..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="app-input w-full px-3 py-2 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingTrial(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXTEND TRIAL MODAL */}
      {extendingTrialModal && (
        <div
          className="form-modal-theme fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center px-2 py-2.5 sm:px-3 sm:py-4"
          onClick={() => busyId === null && setExtendingTrialModal(null)}
        >
          <div
            className="app-card bg-white dark:bg-[#111827] border border-slate-200 dark:border-purple-800/70 rounded-2xl max-w-md w-full p-5 shadow-2xl text-slate-900 dark:text-white space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-500" />
                <h3 className="text-base font-bold">Extend Free Trial</h3>
              </div>
              <button
                type="button"
                onClick={() => setExtendingTrialModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Extend <strong>{extendingTrialModal.storeName}</strong> ({extendingTrialModal.email}). Current expiry: <strong>{formatDateShort(extendingTrialModal.trialEndDate)}</strong>.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[7, 15, 30, 60, 90].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setExtendDaysInput(preset)}
                  className={`px-3 py-1.5 rounded-lg font-mono font-bold text-xs border cursor-pointer ${
                    extendDaysInput === preset
                      ? 'bg-purple-600 text-white border-purple-500'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  +{preset} Days
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Custom Extension Days</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={extendDaysInput}
                onChange={(e) => setExtendDaysInput(Math.max(1, Number(e.target.value || 1)))}
                className="app-input w-full px-3 py-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Notes (optional)</label>
              <input
                type="text"
                placeholder="Reason for extension..."
                value={extendNotesInput}
                onChange={(e) => setExtendNotesInput(e.target.value)}
                className="app-input w-full px-3 py-2 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setExtendingTrialModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyId === extendingTrialModal.id}
                onClick={() => void handleExtendSubmit(extendingTrialModal.id, extendDaysInput, extendNotesInput)}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold cursor-pointer disabled:opacity-50"
              >
                {busyId === extendingTrialModal.id ? 'Extending...' : `Extend +${extendDaysInput} Days`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PERMANENT CASCADE DELETE MODAL */}
      {deletingTrial && (
        <div
          className="form-modal-theme fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center px-2 py-2.5 sm:px-3 sm:py-4"
          onClick={() => !isDeleting && setDeletingTrial(null)}
        >
          <div
            className="app-card bg-white dark:bg-[#111827] border border-rose-200 dark:border-rose-500/40 rounded-2xl max-w-md w-full p-5 shadow-2xl text-slate-900 dark:text-white space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
                <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Permanently Delete Free Trial Store?
                  </h3>
                  <div className="text-xs font-mono text-rose-600 dark:text-rose-300">
                    {deletingTrial.storeName} (Trial #{deletingTrial.id})
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isDeleting && setDeletingTrial(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              This action is irreversible. It will permanently delete <strong>{deletingTrial.storeName}</strong> and wipe all associated store data, trial activation records, <strong>trial tracking history</strong>, notifications, and <strong>activity logs</strong> from all database tables and reports.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingTrial(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Deleting All Records...' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
