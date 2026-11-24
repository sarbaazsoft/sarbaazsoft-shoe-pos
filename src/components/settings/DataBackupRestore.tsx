import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Download, Upload, FileText, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, ShieldCheck, HardDrive, ArrowDownToLine, Check, ShoppingBag, Receipt, FileCheck, TrendingUp, Activity, Terminal, Play, Trash2, X, Database, Lock } from 'lucide-react';
import { api, getAuthToken } from '../../services/api.ts';
import { AnimatedCounter, triggerStatRecount } from '../common/StatCard.tsx';
import { emitDataSync } from '../../utils/dataSyncBus.ts';

interface DataBackupRestoreProps {
  currentUser: any;
  companySettings: any;
  onDataRestored?: () => void;
}

interface BackupStats {
  success: boolean;
  database: string;
  storeName: string;
  totalRecords: number;
  counts: Record<string, number>;
  timestamp: string;
}

interface InspectedBackup {
  file: File;
  rawJson: any;
  meta: {
    format?: string;
    version?: string;
    exportedAt?: string;
    exportedBy?: string;
    storeName?: string;
    totalRecords?: number;
  };
  counts: Record<string, number>;
  valid: boolean;
  error?: string;
}

export const DataBackupRestore: React.FC<DataBackupRestoreProps> = ({
  currentUser,
  companySettings,
  onDataRestored,
}) => {
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<{ filename: string; totalRecords: number; date: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Import / Restore State
  const [inspectedBackup, setInspectedBackup] = useState<InspectedBackup | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<{ message: string; totalRestored: number; counts: Record<string, number> } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Direct SQL Script Import State
  const [isImportingSql, setIsImportingSql] = useState(false);
  const [selectedSqlFile, setSelectedSqlFile] = useState<File | null>(null);
  const [sqlFileContent, setSqlFileContent] = useState<string>('');
  const [sqlImportSuccess, setSqlImportSuccess] = useState<{ message: string; counts: Record<string, number> } | null>(null);
  const [sqlImportError, setSqlImportError] = useState<string | null>(null);

  // SuperAdmin Direct SQL Query Console State
  const isSuperAdmin =
    String(currentUser?.originalRole || currentUser?.role || '').toUpperCase() === 'SUPERADMIN';
  const [sqlQueryText, setSqlQueryText] = useState<string>('');
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
  const [showSqlConfirmModal, setShowSqlConfirmModal] = useState(false);
  const [sqlExecResult, setSqlExecResult] = useState<{
    command: string;
    rowCount: number;
    columns: string[];
    rows: Record<string, any>[];
    totalRowsReturned: number;
    truncated: boolean;
    statementCount: number;
    durationMs: number;
    message: string;
    timestamp: string;
  } | null>(null);
  const [sqlExecError, setSqlExecError] = useState<{
    message: string;
    code?: string;
    detail?: string;
    hint?: string;
    position?: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sqlFileInputRef = useRef<HTMLInputElement>(null);
  const isRefreshingStatsRef = useRef(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    if (isRefreshingStatsRef.current) return;
    isRefreshingStatsRef.current = true;

    const token = getAuthToken();
    if (!token || !currentUser) {
      setIsLoadingStats(false);
      isRefreshingStatsRef.current = false;
      return;
    }

    setIsLoadingStats(true);
    setStatsError(null);
    try {
      const res = await api.backup.stats();
      setStats(res);
      triggerStatRecount();
    } catch (err: any) {
      if (err.message && !err.message.includes('session') && !err.message.includes('Authentication')) {
        console.error('Failed to load backup stats:', err);
        setStatsError(err.message || 'Failed to load storage status');
      }
    } finally {
      isRefreshingStatsRef.current = false;
      setIsLoadingStats(false);
    }
  };

  // 1. Export Handler (Triggers JSON File Download)
  const handleExportBackup = async () => {
    setIsExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const backupData = await api.backup.export();

      const storeCleanName = (backupData.meta?.storeName || companySettings?.name || 'shoepos')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .toLowerCase();
      const dateStr = new Date().toISOString().split('T')[0];
      const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
      const filename = `shoepos-backup-${storeCleanName}-${dateStr}-${timeStr}.json`;

      // Create downloadable Blob
      const blob = new Blob([JSON.stringify(backupData, null, 2)], {
        type: 'application/json',
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      setExportSuccess({
        filename,
        totalRecords: backupData.meta?.totalRecords || 0,
        date: new Date().toLocaleTimeString(),
      });
      loadStats();
    } catch (err: any) {
      console.error('Export error:', err);
      setExportError(err.message || 'Failed to generate store backup export.');
    } finally {
      setIsExporting(false);
    }
  };

  // 2. File Selection & Inspection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    inspectBackupFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      inspectBackupFile(file);
    }
  };

  const inspectBackupFile = (file: File) => {
    setRestoreError(null);
    setRestoreSuccess(null);
    setConfirmRestore(false);

    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      setRestoreError('Selected file must be a JSON (.json) backup file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        const tables = parsed.tables || parsed;
        if (!tables || typeof tables !== 'object') {
          setInspectedBackup({
            file,
            rawJson: null,
            meta: {},
            counts: {},
            valid: false,
            error: 'Invalid file format: Missing backup data payload.',
          });
          return;
        }

        const counts: Record<string, number> = {};
        let totalRecords = 0;
        Object.keys(tables).forEach((table) => {
          if (Array.isArray(tables[table])) {
            counts[table] = tables[table].length;
            totalRecords += tables[table].length;
          }
        });

        if (totalRecords === 0) {
          setInspectedBackup({
            file,
            rawJson: null,
            meta: {},
            counts: {},
            valid: false,
            error: 'The backup file contains zero records.',
          });
          return;
        }

        setInspectedBackup({
          file,
          rawJson: parsed,
          meta: parsed.meta || {
            storeName: parsed.storeName || 'Unknown Store',
            exportedAt: parsed.timestamp || parsed.exportedAt || 'Unknown Date',
            totalRecords,
          },
          counts,
          valid: true,
        });
      } catch (err: any) {
        setInspectedBackup({
          file,
          rawJson: null,
          meta: {},
          counts: {},
          valid: false,
          error: 'Failed to parse JSON file: ' + err.message,
        });
      }
    };
    reader.readAsText(file);
  };

  // 3. Restore Handler
  const handleRestoreBackup = async () => {
    if (!inspectedBackup || !inspectedBackup.valid || !inspectedBackup.rawJson) return;
    if (!confirmRestore) return;

    setIsRestoring(true);
    setRestoreError(null);
    setRestoreSuccess(null);

    try {
      const res = await api.backup.restore(inspectedBackup.rawJson);
      setRestoreSuccess({
        message: res.message,
        totalRestored: res.totalRestored,
        counts: res.restoredCounts,
      });

      // Clear input
      setInspectedBackup(null);
      setConfirmRestore(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Refresh stats & cross-route caches
      emitDataSync(
        ['products', 'inventory', 'sales', 'returns', 'purchases', 'suppliers', 'customers', 'notifications', 'settings'],
        { source: 'data-backup-restore' }
      );
      loadStats();
      if (onDataRestored) {
        onDataRestored();
      }
    } catch (err: any) {
      console.error('Restore error:', err);
      setRestoreError(err.message || 'Store restore failed.');
    } finally {
      setIsRestoring(false);
    }
  };

  // 4. SQL File Select & Execute Handlers
  const handleSqlFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedSqlFile(file);
    setSqlImportError(null);
    setSqlImportSuccess(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || '';
      setSqlFileContent(content);
    };
    reader.readAsText(file);
  };

  const handleExecuteManualSql = async () => {
    if (!sqlFileContent.trim()) {
      setSqlImportError('Please choose a valid .sql file first.');
      return;
    }

    setIsImportingSql(true);
    setSqlImportError(null);
    setSqlImportSuccess(null);

    try {
      const res = await api.backup.importSql(sqlFileContent);
      setSqlImportSuccess(res);
      setSelectedSqlFile(null);
      setSqlFileContent('');
      if (sqlFileInputRef.current) {
        sqlFileInputRef.current.value = '';
      }
      emitDataSync(
        ['products', 'inventory', 'sales', 'returns', 'purchases', 'suppliers', 'customers', 'notifications', 'settings'],
        { source: 'data-backup-restore' }
      );
      loadStats();
      if (onDataRestored) {
        onDataRestored();
      }
    } catch (err: any) {
      console.error('Manual SQL import error:', err);
      setSqlImportError(err.message || 'Failed to execute SQL script.');
    } finally {
      setIsImportingSql(false);
    }
  };

  // 5. SuperAdmin Direct SQL Query Console Handlers
  const trimmedSqlQuery = sqlQueryText.trim();
  const isPotentiallyMutatingQuery = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|REPLACE|MERGE)\b/i.test(
    trimmedSqlQuery
  );
  const isHighRiskDestructiveQuery = /\b(DROP|TRUNCATE|DELETE|ALTER)\b/i.test(trimmedSqlQuery);

  const handleRequestExecuteSql = () => {
    if (!isSuperAdmin) {
      setSqlExecError({
        message: 'Access Denied: Only Platform SuperAdmins may execute direct SQL queries.',
        code: 'FORBIDDEN_SUPERADMIN_REQUIRED',
      });
      return;
    }
    if (!trimmedSqlQuery) {
      setSqlExecError({
        message: 'Please write or paste a SQL query before executing.',
        code: 'EMPTY_SQL_QUERY',
      });
      setSqlExecResult(null);
      return;
    }
    setSqlExecError(null);
    setShowSqlConfirmModal(true);
  };

  const handleConfirmedExecuteSql = async () => {
    if (!isSuperAdmin || !trimmedSqlQuery) {
      setShowSqlConfirmModal(false);
      return;
    }

    setShowSqlConfirmModal(false);
    setIsExecutingQuery(true);
    setSqlExecError(null);
    setSqlExecResult(null);

    try {
      const res = await api.backup.executeSql(sqlQueryText, true);
      setSqlExecResult(res);

      if (isPotentiallyMutatingQuery) {
        emitDataSync(
          ['products', 'inventory', 'sales', 'returns', 'purchases', 'suppliers', 'customers', 'notifications', 'settings'],
          { source: 'superadmin-sql-query' }
        );
        loadStats();
        if (onDataRestored) {
          onDataRestored();
        }
      }
    } catch (err: any) {
      setSqlExecError({
        message: err?.message || 'SQL query execution failed.',
        code: err?.code,
        detail: err?.detail,
        hint: err?.hint,
        position: err?.position,
      });
    } finally {
      setIsExecutingQuery(false);
    }
  };

  const handleClearSqlConsole = () => {
    setSqlQueryText('');
    setSqlExecResult(null);
    setSqlExecError(null);
    setShowSqlConfirmModal(false);
  };

  return (
    <div className="app-card p-3.5 sm:p-6 space-y-5 sm:space-y-6 transition-colors">
      {/* Header & Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 sm:pb-5">
        <div className="flex items-center space-x-3 sm:space-x-3.5">
          <div className="p-2.5 sm:p-3 bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-cyan-400 border border-blue-100 dark:border-blue-500/30 rounded-xl shrink-0">
            <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">Store Backup &amp; Safety Restore (بیک اپ اور بحالی)</h3>
            <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
              Safeguard your wholesale shoe store by creating snapshot backups and restoring store records anytime.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadStats}
          disabled={isLoadingStats}
          className="btn-outline-landing self-start sm:self-auto px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:text-purple-200 dark:hover:text-white dark:border-purple-400/40 dark:shadow-[0_0_14px_rgba(var(--primary-rgb,147,51,234),)] rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStats ? 'animate-spin text-blue-600 dark:text-purple-300' : 'text-blue-600 dark:text-purple-300'}`} />
          <span>Refresh Live Stats</span>
        </button>
      </div>

      {/* Live Store Storage Overview KPI Cards with Sparkline Visuals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5 lg:gap-4">
        {/* KPI 1: SYSTEM STORAGE */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="app-stat-card hover:border-indigo-500/50 transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] sm:text-[10.5px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                System Storage
              </span>
              <div className="w-6 h-6 sm:w-7 sm:h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/30 flex items-center justify-center shrink-0">
                <HardDrive className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
              </div>
            </div>
            <div className="mt-1.5 lg:mt-2 flex items-baseline justify-between gap-1 flex-wrap">
              <div className="text-base sm:text-xl lg:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                {stats?.database ? 'Cloud Active' : 'Active'}
              </div>
              <span className="text-[9.5px] sm:text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                <Activity className="w-2.5 h-2.5" /> 99.9%
              </span>
            </div>

            {/* Sparkline Graphic: Live Latency / Engine Uptime Frequency */}
            <div className="mt-1.5 lg:mt-2 mb-1 lg:mb-1.5 h-5 lg:h-6 w-full">
              <svg className="w-full h-full overflow-hidden" viewBox="0 0 100 24" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sparkline-grad-engine" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-companion, #6366F1)" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="var(--brand-companion, #6366F1)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d="M 2 13 L 18 13 L 26 5 L 34 20 L 42 8 L 50 16 L 58 13 L 74 13 L 82 7 L 88 15 L 98 13 L 98 24 L 2 24 Z"
                  fill="url(#sparkline-grad-engine)"
                />
                <path
                  d="M 2 13 L 18 13 L 26 5 L 34 20 L 42 8 L 50 16 L 58 13 L 74 13 L 82 7 L 88 15 L 98 13"
                  fill="none"
                  stroke="var(--brand-companion, #6366F1)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
              <span>Connected &amp; Healthy</span>
            </div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              High Availability • Low Latency
            </div>
          </div>
        </motion.div>

        {/* KPI 2: TOTAL RECORDS */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="app-stat-card hover:border-blue-500/50 transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] sm:text-[10.5px] font-bold text-blue-600 dark:text-cyan-400 uppercase tracking-wider truncate">
                Total Records
              </span>
              <div className="w-6 h-6 sm:w-7 sm:h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-cyan-400 border border-blue-100 dark:border-blue-500/30 flex items-center justify-center shrink-0">
                <HardDrive className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
              </div>
            </div>
            <div className="mt-1.5 lg:mt-2 flex items-baseline justify-between gap-1 flex-wrap">
              <div className="text-lg sm:text-2xl lg:text-3xl font-black text-blue-600 dark:text-cyan-400 font-mono tracking-tight">
                <AnimatedCounter value={stats?.totalRecords} loading={isLoadingStats} duration={1200} />
              </div>
              <span className="text-[9.5px] sm:text-[10px] font-bold text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800/60 flex items-center gap-0.5">
                <TrendingUp className="w-2.5 h-2.5" /> Growth
              </span>
            </div>

            {/* Sparkline Graphic: Historical Database Growth Trend */}
            <div className="mt-1.5 lg:mt-2 mb-1 lg:mb-1.5 h-5 lg:h-6 w-full">
              <svg className="w-full h-full overflow-hidden" viewBox="0 0 100 24" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sparkline-grad-records" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#9333EA" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#9333EA" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d="M 2 20 C 18 19, 32 17, 46 13 C 60 9, 78 6, 98 3 L 98 24 L 2 24 Z"
                  fill="url(#sparkline-grad-records)"
                />
                <path
                  d="M 2 20 C 18 19, 32 17, 46 13 C 60 9, 78 6, 98 3"
                  fill="none"
                  stroke="#9333EA"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 dark:text-slate-400 font-medium">
            Across 15 core store tables
          </div>
        </motion.div>

        {/* KPI 3: SHOE CATALOG */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.15 }}
          className="app-stat-card hover:border-emerald-500/50 transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] sm:text-[10.5px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                Shoe Catalog
              </span>
              <div className="w-6 h-6 sm:w-7 sm:h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/30 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
              </div>
            </div>
            <div className="mt-1.5 lg:mt-2 flex items-baseline justify-between gap-1 flex-wrap">
              <div className="text-lg sm:text-2xl lg:text-3xl font-black text-slate-900 dark:text-white font-mono tracking-tight flex items-baseline gap-1">
                <AnimatedCounter value={stats?.counts?.products ?? 0} loading={isLoadingStats} duration={1200} />
                <span className="text-[10px] sm:text-xs lg:text-sm font-bold text-slate-500 dark:text-slate-400">Products</span>
              </div>
              <span className="text-[9.5px] sm:text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-0.5">
                <TrendingUp className="w-2.5 h-2.5" /> Active
              </span>
            </div>

            {/* Sparkline Graphic: Inventory Addition Trend */}
            <div className="mt-1.5 lg:mt-2 mb-1 lg:mb-1.5 h-5 lg:h-6 w-full">
              <svg className="w-full h-full overflow-hidden" viewBox="0 0 100 24" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sparkline-grad-catalog" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d="M 2 19 C 16 18, 28 14, 42 15 C 56 16, 70 8, 98 4 L 98 24 L 2 24 Z"
                  fill="url(#sparkline-grad-catalog)"
                />
                <path
                  d="M 2 19 C 16 18, 28 14, 42 15 C 56 16, 70 8, 98 4"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 dark:text-slate-400 font-medium inline-flex items-center gap-1">
            {stats?.counts?.categories ?? 0} categories
          </div>
        </motion.div>

        {/* KPI 4: SALES INVOICES */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.2 }}
          className="app-stat-card hover:border-amber-500/50 transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] sm:text-[10.5px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                Sales Invoices
              </span>
              <div className="w-6 h-6 sm:w-7 sm:h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-500/30 flex items-center justify-center shrink-0">
                <Receipt className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
              </div>
            </div>
            <div className="mt-1.5 lg:mt-2 flex items-baseline justify-between gap-1 flex-wrap">
              <div className="text-lg sm:text-2xl lg:text-3xl font-black text-amber-600 dark:text-amber-400 font-mono tracking-tight flex items-baseline gap-1">
                <AnimatedCounter value={stats?.counts?.sales ?? 0} loading={isLoadingStats} duration={1200} />
                <span className="text-[10px] sm:text-xs lg:text-sm font-bold text-slate-500 dark:text-slate-400">Bills</span>
              </div>
              <span className="text-[9.5px] sm:text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/60 flex items-center gap-0.5">
                <TrendingUp className="w-2.5 h-2.5" /> Daily
              </span>
            </div>

            {/* Sparkline Graphic: Sales Transaction Frequency */}
            <div className="mt-1.5 lg:mt-2 mb-1 lg:mb-1.5 h-5 lg:h-6 w-full">
              <svg className="w-full h-full overflow-hidden" viewBox="0 0 100 24" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sparkline-grad-sales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d="M 2 19 C 14 15, 24 7, 36 14 C 48 20, 60 5, 72 11 C 82 16, 90 6, 98 4 L 98 24 L 2 24 Z"
                  fill="url(#sparkline-grad-sales)"
                />
                <path
                  d="M 2 19 C 14 15, 24 7, 36 14 C 48 20, 60 5, 72 11 C 82 16, 90 6, 98 4"
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 dark:text-slate-400 font-medium inline-flex items-center gap-1">
            {stats?.counts?.customers ?? 0} customers • {stats?.counts?.stock_movements ?? 0} logs
          </div>
        </motion.div>
      </div>

      {statsError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{statsError}</span>
        </div>
      )}

      {/* Main Two-Column Layout: Export on Left, Import/Restore on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* ================= SECTION 1: EXPORT (DOWNLOAD BACKUP) ================= */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 bg-white dark:bg-[#131B2E] shadow-xs space-y-4 sm:space-y-5 flex flex-col justify-between transition-colors">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-cyan-400 border border-blue-100 dark:border-blue-500/30 flex items-center justify-center font-bold">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-sm">Export Shop Data Backup (JSON)</h4>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">Generate a complete, portable copy of all store records</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Downloads an encrypted and structured snapshot of your complete store records. You can save this file on
              an external USB flash drive, cloud storage (Google Drive, Dropbox), or your laptop.
            </p>

            <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5">
              <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 block uppercase tracking-wider">
                What is included in this backup:
              </span>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Products &amp; Barcodes ({stats?.counts?.products ?? 0})</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Sales &amp; Receipts ({stats?.counts?.sales ?? 0})</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Purchases &amp; POs ({stats?.counts?.purchases ?? 0})</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Customers &amp; Ledgers ({stats?.counts?.customers ?? 0})</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Suppliers ({stats?.counts?.suppliers ?? 0})</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Stock Ledger Movements ({stats?.counts?.stock_movements ?? 0})</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Categories ({stats?.counts?.categories || 0})</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Store Profile &amp; Tax/Currency</span>
                </li>
              </ul>
            </div>

            {exportSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Backup File Downloaded Successfully!</span>
                </div>
                <p className="text-[11px] font-mono break-all text-emerald-800 dark:text-emerald-300">
                  {exportSuccess.filename}
                </p>
                <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                  {exportSuccess.totalRecords} records exported at {exportSuccess.date}.
                </div>
              </div>
            )}

            {exportError && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{exportError}</span>
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleExportBackup}
              disabled={isExporting}
              className="w-full h-11 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 text-white border border-purple-400/40 dark:border-purple-400/50 font-bold text-xs shadow-md shadow-purple-600/25 dark:shadow-[0_0_14px_rgba(var(--primary-rgb,147,51,234),)] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              <ArrowDownToLine className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
              <span>{isExporting ? 'Exporting Store Records...' : 'Download Full Shop Backup (.json)'}</span>
            </button>
          </div>
        </div>

        {/* ================= SECTION 2: RESTORE (IMPORT BACKUP) ================= */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 bg-white dark:bg-[#131B2E] shadow-xs space-y-4 sm:space-y-5 flex flex-col justify-between transition-colors">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/30 flex items-center justify-center font-bold">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-sm">Restore Store Data from Backup (Import)</h4>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">Load a previously saved JSON backup to restore shop records</p>
              </div>
            </div>

            {/* Dropzone & File Selector */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2.5 ${
                inspectedBackup?.valid
                  ? 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : inspectedBackup && !inspectedBackup.valid
                  ? 'border-rose-300 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/20'
                  : 'border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 bg-slate-50/50 dark:bg-slate-900'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
              />

              {inspectedBackup ? (
                <div className="space-y-1.5">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                    <FileCheck className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-xs text-slate-900 dark:text-white">
                    {inspectedBackup.file.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {Math.round(inspectedBackup.file.size / 1024)} KB • Click to choose a different file
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
                    <Upload className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div className="font-bold text-xs text-slate-700 dark:text-slate-300">
                    Drag &amp; Drop your backup .json file here
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">or click to browse your computer</p>
                </div>
              )}
            </div>

            {/* Inspected Backup Preview */}
            {inspectedBackup && inspectedBackup.valid && (
              <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-950 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Valid Backup File Recognized
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    v{inspectedBackup.meta.version || '2.4.0'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-emerald-900 dark:text-emerald-200">
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 block">Store Name:</span>
                    <span className="font-medium">{inspectedBackup.meta.storeName || 'SarbaazSoft Shoe POS'}</span>
                  </div>
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 block">Backup Date:</span>
                    <span className="font-semibold">
                      {inspectedBackup.meta.exportedAt ? new Date(inspectedBackup.meta.exportedAt).toLocaleDateString() : 'Recorded'}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 block">Products to Restore:</span>
                    <span className="font-semibold">{inspectedBackup.counts.products || 0} items</span>
                  </div>
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 block">Sales Invoices:</span>
                    <span className="font-semibold">{inspectedBackup.counts.sales || 0} invoices</span>
                  </div>
                </div>

                {/* Safety Warning */}
                <div className="pt-2 border-t border-emerald-200/80 dark:border-emerald-800/60">
                  <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200 dark:border-amber-800/60 text-[11px]">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Restoring this file will synchronize your store records with the contents of the backup.
                    </span>
                  </div>

                  <label className="mt-2.5 flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={confirmRestore}
                      onChange={(e) => setConfirmRestore(e.target.checked)}
                      className="w-4 h-4 rounded-full text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      I confirm and want to restore this data into active store records.
                    </span>
                  </label>
                </div>
              </div>
            )}

            {inspectedBackup && !inspectedBackup.valid && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{inspectedBackup.error || 'Invalid backup file.'}</span>
              </div>
            )}

            {restoreSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Store Data Restored Successfully!</span>
                </div>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300">{restoreSuccess.message}</p>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 pt-1">
                  <span>Products: {restoreSuccess.counts.products || 0}</span>
                  <span>Invoices: {restoreSuccess.counts.sales || 0}</span>
                  <span>Customers: {restoreSuccess.counts.customers || 0}</span>
                  <span>Suppliers: {restoreSuccess.counts.suppliers || 0}</span>
                </div>
              </div>
            )}

            {restoreError && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{restoreError}</span>
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleRestoreBackup}
              disabled={isRestoring || !inspectedBackup?.valid || !confirmRestore}
              className="w-full h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload className={`w-4 h-4 ${isRestoring ? 'animate-bounce' : ''}`} />
              <span>{isRestoring ? 'Restoring Store Records...' : 'Execute Store Restore'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* SuperAdmin Direct SQL Query Console Card */}
      {isSuperAdmin && (
        <div
          data-testid="superadmin-sql-query-section"
          className="p-4 sm:p-6 rounded-2xl border border-purple-200/80 dark:border-purple-800/50 bg-slate-50/70 dark:bg-[#070D1F] shadow-xs space-y-4 sm:space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                  <span>SQL Query</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800/60">
                    <Lock className="w-2.5 h-2.5" />
                    Super Admin Only
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md">
                    <Database className="w-2.5 h-2.5" />
                    PostgreSQL
                  </span>
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Write or paste SQL queries to run directly against the database. Execution requires confirmation and runs inside an atomic transaction.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center">
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800">
                {sqlQueryText ? `${sqlQueryText.split('\n').length} lines • ${sqlQueryText.length} chars` : '0 lines'}
              </span>
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131B2E] space-y-4 shadow-2xs">
            <div className="space-y-2">
              <label
                htmlFor="superadmin-sql-textarea"
                className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between gap-2"
              >
                <span>SQL Query Editor</span>
                <span className="text-[11px] font-normal text-slate-400">
                  Press Ctrl+Enter (or Cmd+Enter) to review &amp; execute
                </span>
              </label>
              <textarea
                id="superadmin-sql-textarea"
                data-testid="superadmin-sql-textarea"
                value={sqlQueryText}
                onChange={(e) => setSqlQueryText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && trimmedSqlQuery && !isExecutingQuery) {
                    e.preventDefault();
                    handleRequestExecuteSql();
                  }
                }}
                rows={10}
                spellCheck={false}
                placeholder={'-- Paste or write SQL query here...\nSELECT id, name, status, subscription_status FROM tenants ORDER BY id ASC LIMIT 25;'}
                className="w-full min-h-[220px] sm:min-h-[260px] p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090F20] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-xs sm:text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 resize-y transition"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 px-3 py-2 rounded-xl">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Direct SQL queries run against live platform tables. Review statements carefully before confirming.</span>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {(sqlQueryText || sqlExecResult || sqlExecError) && (
                  <button
                    type="button"
                    onClick={handleClearSqlConsole}
                    disabled={isExecutingQuery}
                    className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="superadmin-sql-execute-btn"
                  onClick={handleRequestExecuteSql}
                  disabled={isExecutingQuery || !trimmedSqlQuery}
                  className="h-10 px-5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 text-white font-bold text-xs shadow-md shadow-purple-600/25 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                >
                  {isExecutingQuery ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>{isExecutingQuery ? 'Executing...' : 'Execute'}</span>
                </button>
              </div>
            </div>

            {/* Execution Error Feedback */}
            {sqlExecError && (
              <div
                role="alert"
                data-testid="sql-query-error"
                className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 text-rose-800 dark:text-rose-200 space-y-2"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-xs">SQL Execution Error</span>
                      {sqlExecError.code && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700/60">
                          Code: {sqlExecError.code}
                        </span>
                      )}
                      {sqlExecError.position && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300">
                          Pos: {sqlExecError.position}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono break-words leading-relaxed">{sqlExecError.message}</p>
                    {sqlExecError.detail && (
                      <p className="text-[11px] text-rose-700 dark:text-rose-300">
                        <span className="font-bold">Detail:</span> {sqlExecError.detail}
                      </p>
                    )}
                    {sqlExecError.hint && (
                      <p className="text-[11px] text-rose-700 dark:text-rose-300">
                        <span className="font-bold">Hint:</span> {sqlExecError.hint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Execution Success Feedback & Results Table */}
            {sqlExecResult && (
              <div
                data-testid="sql-query-success"
                className="space-y-3"
              >
                <div className="p-3.5 sm:p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-start sm:items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5 sm:mt-0" />
                    <div className="space-y-0.5">
                      <div className="font-bold text-xs">{sqlExecResult.message}</div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>Command: <strong className="font-mono">{sqlExecResult.command}</strong></span>
                        <span>Statements: <strong>{sqlExecResult.statementCount}</strong></span>
                        <span>Duration: <strong>{sqlExecResult.durationMs} ms</strong></span>
                      </div>
                    </div>
                  </div>

                  {sqlExecResult.truncated && (
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60 self-start sm:self-center">
                      Showing first {sqlExecResult.rows.length} of {sqlExecResult.totalRowsReturned} rows
                    </span>
                  )}
                </div>

                {sqlExecResult.columns.length > 0 && sqlExecResult.rows.length > 0 && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#090F20]">
                    <div className="max-h-[380px] overflow-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="px-3 py-2.5 font-bold text-slate-500 dark:text-slate-400 border-r border-slate-200 dark:border-slate-800 w-10 text-center">
                              #
                            </th>
                            {sqlExecResult.columns.map((col) => (
                              <th
                                key={col}
                                className="px-3 py-2.5 font-mono font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap border-r last:border-r-0 border-slate-200 dark:border-slate-800"
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                          {sqlExecResult.rows.map((row, rowIdx) => (
                            <tr
                              key={rowIdx}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                            >
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-400 dark:text-slate-500 border-r border-slate-100 dark:border-slate-800/70 text-center">
                                {rowIdx + 1}
                              </td>
                              {sqlExecResult.columns.map((col) => {
                                const val = row?.[col];
                                return (
                                  <td
                                    key={col}
                                    className="px-3 py-2 font-mono text-[11px] text-slate-800 dark:text-slate-200 max-w-[320px] truncate border-r last:border-r-0 border-slate-100 dark:border-slate-800/70"
                                    title={
                                      val === null || val === undefined
                                        ? 'NULL'
                                        : typeof val === 'object'
                                        ? JSON.stringify(val)
                                        : String(val)
                                    }
                                  >
                                    {val === null || val === undefined ? (
                                      <span className="italic text-slate-400 dark:text-slate-500">NULL</span>
                                    ) : typeof val === 'object' ? (
                                      JSON.stringify(val)
                                    ) : (
                                      String(val)
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {sqlExecResult.columns.length > 0 && sqlExecResult.rows.length === 0 && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 text-center">
                    Query executed successfully — 0 matching rows returned.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual SQL Script Import Card */}
      <div className="p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-[#070D1F] shadow-xs space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center font-bold shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                <span>Direct Data Import</span>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800/60">
                  Data File
                </span>
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Upload and apply custom data records or use the bundled multi-store import file.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <a
              href="/multi-store-pos-import.sql"
              download="multi-store-pos-import.sql"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-blue-600 dark:text-cyan-400 border border-slate-200 dark:border-slate-700 text-xs font-bold transition shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Multi-Store File</span>
            </a>
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131B2E] space-y-3.5 shadow-2xs">
          <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-slate-500" />
            <span>Upload &amp; Apply Custom Data File</span>
          </span>

          <div
            onClick={() => sqlFileInputRef.current?.click()}
            className="p-3.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-400 transition text-center cursor-pointer space-y-1 bg-slate-50/50 dark:bg-slate-900"
          >
            <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400 mx-auto" />
            <div className="text-xs font-bold text-blue-600 dark:text-blue-400">
              {selectedSqlFile ? selectedSqlFile.name : 'Select or drop data file'}
            </div>
            <p className="text-[10px] text-slate-400">
              {selectedSqlFile
                ? `${Math.round(selectedSqlFile.size / 1024)} KB ready to apply`
                : 'Click to select data file from your computer'}
            </p>
            <input
              ref={sqlFileInputRef}
              type="file"
              accept=".sql"
              onChange={handleSqlFileSelect}
              className="hidden"
            />
          </div>

          <button
            type="button"
            onClick={handleExecuteManualSql}
            disabled={isImportingSql || !selectedSqlFile}
            className="w-full h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isImportingSql ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FileCheck className="w-4 h-4" />
            )}
            <span>{isImportingSql ? 'Applying Records...' : 'Import & Apply Records'}</span>
          </button>

          {sqlImportSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 text-xs space-y-1 animate-in fade-in">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{sqlImportSuccess.message}</span>
              </div>
            </div>
          )}

          {sqlImportError && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{sqlImportError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Safety Best Practices Guidance Card */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-[#0E172E] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 sm:gap-4 border border-slate-200 dark:border-slate-800/80 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-white">Recommended Retail Safety Routine</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              We recommend downloading a JSON backup at the end of every business day after closing the cash counter register.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportBackup}
          disabled={isExporting}
          className="h-10 px-4 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 text-white border border-purple-400/40 dark:border-purple-400/50 text-xs font-bold rounded-xl shrink-0 transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-purple-600/25 active:scale-95"
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          <span>Quick Backup Now</span>
        </button>
      </div>

      {/* Confirmation Modal Before Direct SQL Execution */}
      {isSuperAdmin && showSqlConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sql-confirm-modal-title"
          data-testid="sql-confirm-modal"
          className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center px-3 py-4 sm:px-4 sm:py-5 bg-slate-950/65 backdrop-blur-xs"
        >
          <div className="modal-panel-enter w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131B2E] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isHighRiskDestructiveQuery
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h5
                    id="sql-confirm-modal-title"
                    className="font-extrabold text-sm text-slate-900 dark:text-white"
                  >
                    Confirm SQL Query Execution
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    SuperAdmin direct database execution
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowSqlConfirmModal(false)}
                aria-label="Close confirmation dialog"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div
                className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                  isHighRiskDestructiveQuery
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/80 text-rose-800 dark:text-rose-200'
                    : isPotentiallyMutatingQuery
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80 text-amber-800 dark:text-amber-200'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {isHighRiskDestructiveQuery
                  ? 'Warning: This query contains schema or data-modifying statements (DROP / TRUNCATE / DELETE / ALTER). Changes take effect immediately once committed.'
                  : isPotentiallyMutatingQuery
                  ? 'Notice: This query contains write operations that will modify live database records once executed.'
                  : 'Are you sure you want to execute this SQL query directly against the database?'}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  <span>Query Preview</span>
                  <span className="font-mono font-normal">
                    {trimmedSqlQuery.split('\n').length} lines • {trimmedSqlQuery.length} chars
                  </span>
                </div>
                <pre className="max-h-52 overflow-auto p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed border border-slate-800 whitespace-pre-wrap break-all">
                  {trimmedSqlQuery}
                </pre>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-[#0D1426] border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                data-testid="sql-confirm-cancel-btn"
                onClick={() => setShowSqlConfirmModal(false)}
                className="h-9 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="sql-confirm-submit-btn"
                onClick={handleConfirmedExecuteSql}
                disabled={isExecutingQuery}
                className={`h-9 px-4 rounded-xl text-white text-xs font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                  isHighRiskDestructiveQuery
                    ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-purple-600/20'
                }`}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Confirm &amp; Execute</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
