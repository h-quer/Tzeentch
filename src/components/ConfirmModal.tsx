import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ 
  isOpen, 
  title, 
  message, 
  confirmText = 'Confirm', 
  cancelText = 'Cancel', 
  onConfirm, 
  onCancel 
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-tzeentch-bg/80 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-tzeentch-card border border-tzeentch-cyan/30 p-6 rounded-2xl shadow-[0_0_40px_rgba(34,211,238,0.15)] max-w-md w-full"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-red-500/10 rounded-full">
                <AlertTriangle className="text-red-500" size={24} />
              </div>
              <h3 className="text-xl font-bold text-tzeentch-cyan font-display">{title}</h3>
            </div>
            <p className="text-tzeentch-text/80 mb-8 leading-relaxed">
              {message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className="px-4 py-2 rounded-xl text-tzeentch-text/70 hover:text-tzeentch-text hover:bg-tzeentch-cyan/10 transition-colors font-bold text-sm"
              >
                {cancelText}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirm();
                }}
                className="px-4 py-2 rounded-xl bg-tzeentch-cyan text-tzeentch-bg hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] transition-all font-bold text-sm"
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ConfirmModal;
