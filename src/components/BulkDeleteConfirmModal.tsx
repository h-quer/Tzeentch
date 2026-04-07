import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface BulkDeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  count: number;
}

export default function BulkDeleteConfirmModal({ isOpen, onClose, onConfirm, count }: BulkDeleteConfirmModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-tzeentch-overlay backdrop-blur-md"
          />
          
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative w-full max-w-md bg-tzeentch-bg border border-tzeentch-magenta/30 rounded-2xl shadow-[0_0_50px_rgba(255,0,128,0.15)] overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-tzeentch-magenta/20 bg-tzeentch-card/30 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-tzeentch-magenta/10 rounded-full flex items-center justify-center text-tzeentch-magenta border border-tzeentch-magenta/20">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-tzeentch-magenta tracking-tight">Confirm Deletion</h2>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-tzeentch-magenta/40 hover:text-tzeentch-magenta hover:bg-tzeentch-magenta/10 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <p className="text-tzeentch-text">
                Are you sure you want to delete <strong className="text-tzeentch-magenta">{count}</strong> books?
              </p>
              <p className="text-sm text-tzeentch-text-muted">
                This action cannot be undone. The entries will be removed from your library and their cover images will be deleted.
              </p>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isDeleting}
                  className="px-6 py-2.5 rounded-lg border border-tzeentch-cyan/20 text-tzeentch-text/90 hover:bg-tzeentch-cyan/10 transition-all text-sm font-bold disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isDeleting}
                  className="px-6 py-2.5 rounded-lg bg-tzeentch-magenta text-white hover:bg-tzeentch-magenta/80 transition-all text-sm font-bold shadow-[0_0_20px_rgba(255,0,128,0.3)] disabled:opacity-50 flex items-center gap-2"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Selected'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
