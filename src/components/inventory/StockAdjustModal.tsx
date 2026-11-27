import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, SlidersHorizontal, AlertCircle } from 'lucide-react';
import { api } from '../../services/api.ts';
import { toTitleCaseLive, toTitleCaseTrimmed } from '../../utils/textFormat.ts';
import {
  calculateCartonsFromPairs,
  getWholesaleStockStep,
  isHalfCartonAllowed,
  validateWholesaleStockQuantity,
} from '../../schemas/productSchema.ts';

interface StockAdjustModalProps {
  product: any;
  companySettings?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export const StockAdjustModal: React.FC<StockAdjustModalProps> = ({
  product,
  companySettings,
  onClose,
  onSuccess,
}) => {
  const [newTotalStockInput, setNewTotalStockInput] = useState<string>(String(product.totalStock ?? 0));
  const [reason, setReason] = useState('Stock audit discrepancy');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWholesaleStore =
    String(companySettings?.businessType || companySettings?.business_type || '').toUpperCase() === 'WHOLESALE';
  const rawPpc = Number(product?.pairsPerCarton ?? product?.pairs_per_carton);
  const pairsPerCarton = Number.isFinite(rawPpc) && rawPpc > 0 ? rawPpc : 12;
  const allowHalfCarton = isHalfCartonAllowed(product, companySettings);
  const wholesaleStep = getWholesaleStockStep({ pairsPerCarton, allowHalfCarton }, companySettings);

  const wholesaleValidation = isWholesaleStore
    ? validateWholesaleStockQuantity({
        quantity: newTotalStockInput,
        pairsPerCarton,
        allowHalfCarton,
        isWholesaleStore: true,
      })
    : null;

  const currentStock = Number(product.totalStock ?? 0);
  const effectiveNewStock = isWholesaleStore
    ? wholesaleValidation?.valid && wholesaleValidation.normalizedQuantity !== null
      ? wholesaleValidation.normalizedQuantity
      : Number.isFinite(Number(newTotalStockInput)) && newTotalStockInput.trim() !== ''
      ? Number(newTotalStockInput)
      : currentStock
    : parseInt(newTotalStockInput, 10) || 0;

  const diff = isWholesaleStore
    ? Math.round((effectiveNewStock - currentStock) * 10000) / 10000
    : effectiveNewStock - currentStock;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      return setError('Reason is mandatory for inventory audit trail.');
    }

    let targetStock = effectiveNewStock;
    if (isWholesaleStore) {
      const check = validateWholesaleStockQuantity({
        quantity: newTotalStockInput,
        pairsPerCarton,
        allowHalfCarton,
        isWholesaleStore: true,
      });
      if (!check.valid || check.normalizedQuantity === null) {
        return setError(check.error || 'Invalid wholesale stock quantity.');
      }
      targetStock = check.normalizedQuantity;
    }

    if (targetStock === currentStock) {
      return setError('New stock matches current stock. No change needed.');
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await api.inventory.adjust({
        productId: product.id,
        newStock: targetStock,
        reason: toTitleCaseTrimmed(reason),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to adjust stock.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const showLiveWholesaleError =
    isWholesaleStore && newTotalStockInput.trim() !== '' && wholesaleValidation && !wholesaleValidation.valid;

  return (
    <motion.div
      data-motion-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="form-modal-theme fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 md:p-8 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        data-motion-modal="true"
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm sm:max-w-md lg:max-w-lg my-auto app-modal-container overflow-hidden flex flex-col max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50 dark:bg-gradient-to-r dark:from-purple-900 dark:via-indigo-950 dark:to-slate-900 border-b border-slate-200 dark:border-purple-800/80 text-slate-900 dark:text-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-50 dark:bg-purple-500/20 text-blue-600 dark:text-purple-300 border border-blue-200 dark:border-purple-400/30 rounded-xl shadow-2xs">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">Adjust Physical Stock</h3>
          </div>
          <button onClick={onClose} className="p-2 sm:p-1.5 text-slate-400 hover:text-slate-700 dark:text-purple-300 dark:hover:text-white cursor-pointer transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-400 rounded-xl flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3.5 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl">
            <div className="font-bold text-sm text-slate-900 dark:text-white">{product.article || product.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
              Barcode: {product.barcode}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Current Stock</span>
              <div className="text-xl font-bold font-mono text-slate-800 dark:text-slate-200 mt-1">
                {currentStock} pairs
              </div>
              {isWholesaleStore && (
                <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-300 mt-0.5">
                  {calculateCartonsFromPairs(currentStock, pairsPerCarton)} cartons
                </div>
              )}
            </div>

            <div className="p-3 bg-blue-50/50 dark:bg-blue-950/40 border border-blue-200 dark:border-cyan-500/30 rounded-xl">
              <span className="text-[10px] uppercase font-bold text-blue-700 dark:text-cyan-400">Stock Difference</span>
              <div
                className={`text-xl font-bold font-mono mt-1 ${
                  diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {diff > 0 ? `+${diff}` : diff}
              </div>
              {isWholesaleStore && wholesaleValidation?.valid && (
                <div className="text-[10px] font-mono text-blue-700 dark:text-cyan-300 mt-0.5">
                  New: {wholesaleValidation.cartons} cartons
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">New Total Count (Pairs) *</label>
            {isWholesaleStore ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      const base = Number.isFinite(Number(newTotalStockInput)) && newTotalStockInput.trim() !== '' ? Number(newTotalStockInput) : currentStock;
                      const next = Math.max(0, Math.round((base - wholesaleStep) * 10000) / 10000);
                      setNewTotalStockInput(String(next));
                    }}
                    className="w-9 h-9 rounded-lg border border-indigo-200 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900 font-bold text-indigo-800 dark:text-indigo-200 text-sm cursor-pointer transition"
                    title={`Decrease by ${wholesaleStep} pairs`}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="0"
                    step={wholesaleStep}
                    required
                    value={newTotalStockInput}
                    onChange={(e) => {
                      setError(null);
                      setNewTotalStockInput(e.target.value);
                    }}
                    className={`app-input flex-1 px-3 py-2 text-sm font-bold font-mono text-center ${
                      showLiveWholesaleError ? 'border-rose-500 focus:border-rose-500' : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      const base = Number.isFinite(Number(newTotalStockInput)) && newTotalStockInput.trim() !== '' ? Number(newTotalStockInput) : currentStock;
                      const next = Math.round((base + wholesaleStep) * 10000) / 10000;
                      setNewTotalStockInput(String(next));
                    }}
                    className="w-9 h-9 rounded-lg border border-indigo-200 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900 font-bold text-indigo-800 dark:text-indigo-200 text-sm cursor-pointer transition"
                    title={`Increase by ${wholesaleStep} pairs`}
                  >
                    +
                  </button>
                </div>
                {showLiveWholesaleError ? (
                  <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    {wholesaleValidation.error}
                  </p>
                ) : (
                  <p className="text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">
                    Allowed increment: <span className="font-mono font-bold">{wholesaleStep} pairs</span> (
                    {allowHalfCarton ? '0.5 carton' : 'full carton'} of {pairsPerCarton} pairs/ctn)
                  </p>
                )}
              </div>
            ) : (
              <input
                type="number"
                min="0"
                required
                value={newTotalStockInput}
                onChange={(e) => setNewTotalStockInput(e.target.value)}
                className="app-input w-full px-3 py-2 text-sm font-bold font-mono text-center"
              />
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Audit Reason / Investigation Notes *
            </label>
            <textarea
              rows={3}
              required
              placeholder="e.g. Physical inventory count correction, damaged pair found, sample write-off..."
              value={reason}
              onChange={(e) => setReason(toTitleCaseLive(e.target.value))}
              className="capitalize app-input w-full px-3 py-2 text-xs"
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              This adjustment will be permanently recorded with your admin ID in the stock movements ledger.
            </p>
          </div>

          <div className="px-4 sm:px-6 py-3.5 sm:py-4 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 mt-4 bg-slate-50 dark:bg-gradient-to-r dark:from-purple-900/90 dark:via-indigo-950/85 dark:to-slate-900 border-t border-slate-200 dark:border-purple-800/80 flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary px-4 py-2.5 sm:py-2 min-h-[42px] sm:min-h-0 text-xs font-semibold rounded-xl cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(showLiveWholesaleError)}
              className="btn-primary px-5 py-2.5 sm:py-2 min-h-[42px] sm:min-h-0 text-xs font-bold rounded-xl flex items-center space-x-2 text-white cursor-pointer active:scale-95 disabled:opacity-50"
            >
              <span>{isSubmitting ? 'Recording...' : 'Commit Adjustment'}</span>
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};
