import React, { useState, useEffect } from 'react';
import { X, Search, Book as BookIcon, Loader2, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SearchResult, Book } from '../types';

interface ManualRefreshModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  onSuccess: (updatedBook: Book) => void;
}

export default function ManualRefreshModal({ isOpen, onClose, book, onSuccess }: ManualRefreshModalProps) {
  const [query, setQuery] = useState(book.title);
  const [source, setSource] = useState<'google' | 'audible' | 'goodreads'>('google');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery(book.title);
      setResults([]);
      setSelectedResult(null);
      setIsUpdating(false);
      setError(null);
    }
  }, [isOpen, book]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&source=${source}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        setResults(data);
      } else {
        console.error('Search API returned non-array data:', data);
        setResults([]);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    if (!selectedResult) return;

    setIsUpdating(true);
    try {
      // We'll use a new endpoint or the existing PATCH endpoint
      // The user wants to overwrite ALL metadata.
      // We'll send the metadata fields to the PATCH endpoint.
      const metadataUpdates = {
        title: selectedResult.title,
        author: selectedResult.author,
        narrator: selectedResult.narrator,
        isbn: selectedResult.isbn,
        asin: selectedResult.asin,
        cover_url: selectedResult.cover_url, // Backend will handle download if we update PATCH
        description: selectedResult.description,
        page_count: selectedResult.pageCount,
        published_date: selectedResult.publishedDate,
        publisher: selectedResult.publisher,
        series: selectedResult.series,
        series_number: selectedResult.series_number,
        metadata_source: selectedResult.metadata_source,
      };

      const response = await fetch(`/api/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadataUpdates),
      });
      
      const data = await response.json();
      if (data.success) {
        onSuccess(data.book);
        onClose();
      } else {
        setError('Failed to update metadata: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to refresh metadata:', error);
      setError('An unexpected error occurred.');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
        className="relative bg-tzeentch-bg w-full max-w-2xl rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[90vh] border border-tzeentch-cyan/30"
      >
        {/* Header */}
        <div className="px-6 sm:px-8 py-4 sm:py-6 border-b border-tzeentch-cyan/10 flex justify-between items-center bg-tzeentch-card/50 backdrop-blur-md">
          <h2 className="text-xl sm:text-2xl font-bold text-tzeentch-cyan font-display tracking-tighter">MANUAL REFRESH</h2>
          <button onClick={onClose} className="p-2 hover:bg-tzeentch-cyan/10 rounded-full transition-colors">
            <X size={20} className="sm:w-[24px] sm:h-[24px] text-tzeentch-cyan/40" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-tzeentch-bg no-scrollbar">
          {error && (
            <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl flex gap-4 mb-6 text-red-400 text-sm font-medium">
              <AlertTriangle size={20} className="shrink-0" />
              {error}
            </div>
          )}
          {!selectedResult ? (
            <div className="space-y-6">
              <div className="p-4 bg-tzeentch-magenta/10 border border-tzeentch-magenta/30 rounded-xl flex gap-4 mb-6">
                <div className="text-tzeentch-magenta flex-shrink-0">
                  <AlertTriangle size={24} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-tzeentch-magenta uppercase tracking-widest">Manual Metadata Overwrite</p>
                  <p className="text-xs text-tzeentch-text-muted leading-relaxed">
                    Search and select a tome to <span className="text-tzeentch-magenta font-bold">OVERWRITE ALL METADATA</span> for "{book.title}".
                  </p>
                </div>
              </div>

              {/* Source Selector */}
              <div className="flex gap-2 p-1 bg-tzeentch-card/50 rounded-xl border border-tzeentch-cyan/10">
                {(['google', 'audible', 'goodreads'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${source === s ? 'bg-tzeentch-cyan text-tzeentch-bg' : 'text-tzeentch-cyan/40 hover:text-tzeentch-cyan'}`}
                  >
                    {s === 'google' ? 'Google Books' : s}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSearch} className="relative">
                <input 
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for correct metadata..."
                  className="w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-4 bg-tzeentch-card border border-tzeentch-cyan/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-tzeentch-cyan/30 font-sans transition-all text-sm sm:text-base text-tzeentch-text placeholder:text-tzeentch-text-faint/80"
                  autoFocus
                />
                <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-tzeentch-cyan/40" size={18} />
                <button 
                  type="submit"
                  disabled={loading}
                  className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 px-3 sm:px-4 py-1.5 sm:py-2 bg-tzeentch-cyan text-tzeentch-bg rounded-lg text-xs sm:text-sm font-bold hover:bg-tzeentch-cyan/80 transition-colors disabled:opacity-50 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : 'SEARCH'}
                </button>
              </form>

              <div className="grid grid-cols-1 gap-4">
                {results.map((result, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedResult(result)}
                    className="flex gap-4 p-4 bg-tzeentch-card/40 rounded-xl border border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40 hover:bg-tzeentch-card/60 transition-all text-left group"
                  >
                    <div className="w-16 h-24 bg-tzeentch-warp/40 rounded-lg overflow-hidden flex-shrink-0 border border-tzeentch-cyan/5">
                      {result.cover_url ? (
                        <img src={result.cover_url} alt={result.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-tzeentch-cyan/10">
                          <BookIcon size={24} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-tzeentch-cyan group-hover:text-tzeentch-cyan transition-colors line-clamp-1">{result.title}</h4>
                      <p className="text-sm text-tzeentch-text-muted font-medium mb-1">{result.author}</p>
                      {result.series && (
                        <p className="text-xs text-tzeentch-cyan/80 font-medium mb-1">
                          Series: {result.series}
                          {result.series_number && ` #${result.series_number}`}
                        </p>
                      )}
                      {result.narrator && <p className="text-xs text-tzeentch-text-faint font-medium mb-1 italic">Narrated by: {result.narrator}</p>}
                      <p className="text-xs text-tzeentch-text-faint font-sans line-clamp-2">{result.description}</p>
                    </div>
                  </button>
                ))}
                
                {!loading && results.length === 0 && query && (
                  <div className="text-center py-12">
                    <p className="text-tzeentch-cyan/40 italic font-sans">No results found in the Warp.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 sm:space-y-8">
              <div className="text-center space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-8">
                  <div className="text-center space-y-2">
                    <div className="w-20 sm:w-24 h-30 sm:h-36 bg-tzeentch-warp/40 rounded-lg overflow-hidden border border-tzeentch-cyan/20 mx-auto opacity-40">
                      {book.cover_url ? (
                        <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-tzeentch-cyan/10">
                          <BookIcon size={32} />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] font-bold text-tzeentch-text-muted uppercase tracking-widest">Current</p>
                  </div>
                  
                  <div className="text-tzeentch-cyan animate-pulse rotate-90 sm:rotate-0">
                    <RefreshCw size={24} className="sm:w-[32px] sm:h-[32px]" />
                  </div>

                  <div className="text-center space-y-2">
                    <div className="w-20 sm:w-24 h-30 sm:h-36 bg-tzeentch-warp/40 rounded-lg overflow-hidden border border-tzeentch-cyan/40 mx-auto shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                      {selectedResult.cover_url ? (
                        <img src={selectedResult.cover_url} alt={selectedResult.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-tzeentch-cyan/10">
                          <BookIcon size={32} />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] font-bold text-tzeentch-cyan uppercase tracking-widest">New</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-tzeentch-cyan">CONFIRM OVERWRITE</h3>
                  <p className="text-sm text-tzeentch-text-muted">
                    Are you sure you want to replace the metadata of <span className="text-tzeentch-text font-bold">"{book.title}"</span> with the selected result?
                  </p>
                </div>

                <div className="bg-tzeentch-card/30 p-4 rounded-xl border border-tzeentch-cyan/10 text-left space-y-2">
                  <p className="text-xs font-bold text-tzeentch-cyan/40 uppercase tracking-widest">New Metadata Preview</p>
                  <p className="text-sm font-bold text-tzeentch-text">{selectedResult.title}</p>
                  <p className="text-xs text-tzeentch-text-muted italic">{selectedResult.author}</p>
                  {selectedResult.isbn && <p className="text-[10px] text-tzeentch-text-faint">ISBN: {selectedResult.isbn}</p>}
                  {selectedResult.asin && <p className="text-[10px] text-tzeentch-text-faint">ASIN: {selectedResult.asin}</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedResult && (
          <div className="px-6 sm:px-8 py-4 sm:py-6 border-t border-tzeentch-cyan/10 bg-tzeentch-card/50 backdrop-blur-md flex justify-end gap-3">
            <button 
              onClick={() => setSelectedResult(null)}
              disabled={isUpdating}
              className="px-4 sm:px-6 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-bold text-tzeentch-text-muted hover:text-tzeentch-text transition-colors"
            >
              BACK
            </button>
            <button 
              onClick={handleManualRefresh}
              disabled={isUpdating}
              className="px-6 sm:px-8 py-2 sm:py-3 bg-tzeentch-cyan text-tzeentch-bg rounded-xl text-xs sm:text-sm font-bold hover:bg-tzeentch-cyan/80 transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)] flex items-center gap-2"
            >
              {isUpdating ? <Loader2 size={16} className="sm:w-[18px] sm:h-[18px] animate-spin" /> : <Check size={16} className="sm:w-[18px] sm:h-[18px]" />}
              {isUpdating ? 'COMMUNING...' : 'OVERWRITE'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
