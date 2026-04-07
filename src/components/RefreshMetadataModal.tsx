import React, { useState } from 'react';
import { X, RefreshCw, AlertTriangle, Loader2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface RefreshMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: number[];
  onSuccess: () => void;
}

export default function RefreshMetadataModal({ isOpen, onClose, selectedIds, onSuccess }: RefreshMetadataModalProps) {
  const [provider, setProvider] = useState<'google' | 'audible' | 'goodreads' | 'none'>('none');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'processing' | 'complete'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setLoading(true);
    setStatus('processing');
    setProgress(0);
    setError(null);

    try {
      const response = await fetch('/api/books/bulk-refresh-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: selectedIds,
          provider: provider === 'none' ? undefined : provider
        }),
      });

      if (response.ok) {
        setStatus('complete');
        setTimeout(() => {
          onSuccess();
          onClose();
          // Reset state after closing
          setTimeout(() => {
            setStatus('idle');
            setLoading(false);
            setProgress(0);
          }, 300);
        }, 1500);
      } else {
        const errorData = await response.json();
        setError(`Error: ${errorData.error || 'Failed to refresh metadata'}`);
        setLoading(false);
        setStatus('idle');
      }
    } catch (error) {
      console.error('Refresh error:', error);
      setError('An unexpected error occurred.');
      setLoading(false);
      setStatus('idle');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-tzeentch-overlay backdrop-blur-sm"
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-tzeentch-bg w-full max-w-md rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden border border-tzeentch-cyan/30"
      >
        <div className="px-8 py-6 border-b border-tzeentch-cyan/10 flex justify-between items-center bg-tzeentch-card/50 backdrop-blur-md">
          <h2 className="text-xl font-bold text-tzeentch-cyan font-display tracking-tighter flex items-center gap-2">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            REFRESH METADATA
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-tzeentch-cyan/10 rounded-full transition-colors">
            <X size={20} className="text-tzeentch-cyan/40" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          {error && (
            <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl flex gap-4 text-red-400 text-sm font-medium">
              <AlertTriangle size={20} className="shrink-0" />
              {error}
            </div>
          )}
          {status === 'complete' ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-16 h-16 bg-tzeentch-cyan/10 text-tzeentch-cyan rounded-full flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                <Check size={32} />
              </div>
              <h3 className="text-xl font-bold text-tzeentch-cyan">RITUAL COMPLETE</h3>
              <p className="text-tzeentch-text-muted">The archives have been updated with fresh knowledge.</p>
            </div>
          ) : (
            <>
              <div className="p-4 bg-tzeentch-magenta/10 border border-tzeentch-magenta/30 rounded-xl flex gap-4">
                <div className="text-tzeentch-magenta flex-shrink-0">
                  <AlertTriangle size={24} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-tzeentch-magenta uppercase tracking-widest">Warning: Data Overwrite</p>
                  <p className="text-xs text-tzeentch-text-muted leading-relaxed">
                    This ritual will <span className="text-tzeentch-magenta font-bold">OVERWRITE ALL METADATA</span> for the {selectedIds.length} selected tomes. Only reading progress (start/finish dates) will be preserved.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs font-bold text-tzeentch-cyan/60 uppercase tracking-widest px-1">Select Metadata Provider</p>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setProvider('none');
                    }}
                    disabled={loading}
                    className={`
                      p-4 rounded-xl border-2 transition-all flex items-center justify-between
                      ${provider === 'none' ? 'border-tzeentch-cyan bg-tzeentch-cyan/10 text-tzeentch-cyan' : 'border-tzeentch-cyan/10 bg-tzeentch-card/30 text-tzeentch-text-muted hover:border-tzeentch-cyan/30'}
                    `}
                  >
                    <div className="text-left">
                      <p className="text-sm font-bold uppercase tracking-widest">Auto-Detect</p>
                      <p className="text-[10px] opacity-60">Use saved source or fallback to Google Books</p>
                    </div>
                    {provider === 'none' && <Check size={16} />}
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setProvider('google');
                    }}
                    disabled={loading}
                    className={`
                      p-4 rounded-xl border-2 transition-all flex items-center justify-between
                      ${provider === 'google' ? 'border-tzeentch-cyan bg-tzeentch-cyan/10 text-tzeentch-cyan' : 'border-tzeentch-cyan/10 bg-tzeentch-card/30 text-tzeentch-text-muted hover:border-tzeentch-cyan/30'}
                    `}
                  >
                    <div className="text-left">
                      <p className="text-sm font-bold uppercase tracking-widest">Google Books</p>
                      <p className="text-[10px] opacity-60">Best for general books and ISBNs</p>
                    </div>
                    {provider === 'google' && <Check size={16} />}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setProvider('audible');
                    }}
                    disabled={loading}
                    className={`
                      p-4 rounded-xl border-2 transition-all flex items-center justify-between
                      ${provider === 'audible' ? 'border-tzeentch-magenta bg-tzeentch-magenta/10 text-tzeentch-magenta' : 'border-tzeentch-magenta/10 bg-tzeentch-card/30 text-tzeentch-text-muted hover:border-tzeentch-magenta/30'}
                    `}
                  >
                    <div className="text-left">
                      <p className="text-sm font-bold uppercase tracking-widest">Audible</p>
                      <p className="text-[10px] opacity-60">Best for audiobooks and ASINs</p>
                    </div>
                    {provider === 'audible' && <Check size={16} />}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setProvider('goodreads');
                    }}
                    disabled={loading}
                    className={`
                      p-4 rounded-xl border-2 transition-all flex items-center justify-between
                      ${provider === 'goodreads' ? 'border-tzeentch-gold bg-tzeentch-gold/10 text-tzeentch-gold' : 'border-tzeentch-gold/10 bg-tzeentch-card/30 text-tzeentch-text-muted hover:border-tzeentch-gold/30'}
                    `}
                  >
                    <div className="text-left">
                      <p className="text-sm font-bold uppercase tracking-widest">Goodreads</p>
                      <p className="text-[10px] opacity-60">Comprehensive community data</p>
                    </div>
                    {provider === 'goodreads' && <Check size={16} />}
                  </button>
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  disabled={loading}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-tzeentch-cyan/60 hover:text-tzeentch-cyan transition-colors uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRefresh();
                  }}
                  disabled={loading}
                  className="flex-[2] py-3 bg-tzeentch-cyan text-tzeentch-bg rounded-xl text-sm font-bold hover:bg-tzeentch-cyan/80 transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)] uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      COMMUNING...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={18} />
                      INITIATE REFRESH
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
