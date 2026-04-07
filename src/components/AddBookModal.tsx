import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Book as BookIcon, Headphones, Star, Check, Loader2, Tag, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SearchResult, Book, BookStatus, BookFormat } from '../types';

interface AddBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  viewPreferences?: Record<string, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
}

export default function AddBookModal({ isOpen, onClose, onSuccess, viewPreferences }: AddBookModalProps) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'google' | 'audible' | 'goodreads'>('google');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState<BookStatus>('Backlog');
  const [format, setFormat] = useState<BookFormat>('Book');
  const [rating, setRating] = useState(0);
  const [startedReading, setStartedReading] = useState('');
  const [finishedReading, setFinishedReading] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/tags')
        .then(res => res.json())
        .then(setAvailableTags)
        .catch(err => console.error('Failed to fetch tags:', err));
    } else {
      // Cancel any ongoing fetch when modal closes
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // Reset state when closed
      setQuery('');
      setResults([]);
      setSelectedBook(null);
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedBook) {
      const initialTags = selectedBook.categories ? selectedBook.categories.split(',').map(t => t.trim()).filter(Boolean) : [];
      setSelectedTags(initialTags);
    }
  }, [selectedBook]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsTagDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags([...selectedTags, trimmed]);
    }
    setTagInput('');
    setIsTagDropdownOpen(false);
  };

  const removeTag = (tag: string) => {
    setSelectedTags(selectedTags.filter(t => t !== tag));
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    // Cancel previous request if still running
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&source=${source}`, {
        signal: abortController.signal
      });
      const data = await response.json();
      if (Array.isArray(data)) {
        setResults(data);
      } else {
        console.error('Search API returned non-array data:', data);
        setResults([]);
      }
      // Default format to Audiobook if searching Audible
      if (source === 'audible') {
        setFormat('Audiobook');
      } else {
        setFormat('Book');
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Search request cancelled');
      } else {
        console.error('Search failed:', error);
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleAdd = async () => {
    if (!selectedBook) return;

    const newBook: Omit<Book, 'id'> = {
      title: selectedBook.title,
      author: selectedBook.author,
      narrator: selectedBook.narrator,
      isbn: selectedBook.isbn,
      asin: selectedBook.asin,
      cover_url: selectedBook.cover_url,
      status,
      format,
      rating,
      started_reading: startedReading || undefined,
      finished_reading: finishedReading || undefined,
      description: selectedBook.description,
      page_count: selectedBook.pageCount,
      published_date: selectedBook.publishedDate,
      publisher: selectedBook.publisher,
      tags: selectedTags.join(', '),
      series: selectedBook.series,
      series_number: selectedBook.series_number,
      metadata_source: selectedBook.metadata_source,
    };

    try {
      await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBook),
      });
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Failed to add book:', error);
    }
  };

  const handleClose = () => {
    setQuery('');
    setResults([]);
    setSelectedBook(null);
    setStatus('Backlog');
    setFormat('Book');
    setRating(0);
    setStartedReading('');
    setFinishedReading('');
    setSelectedTags([]);
    setTagInput('');
    onClose();
  };

  const handleStatusChange = (newStatus: BookStatus) => {
    setStatus(newStatus);
    const today = new Date().toISOString().split('T')[0];
    if (newStatus === 'Reading') {
      setFinishedReading('');
      if (!startedReading) {
        setStartedReading(today);
      }
    } else if (newStatus === 'Read') {
      if (!finishedReading) {
        setFinishedReading(today);
      }
      if (!startedReading) {
        setStartedReading(today);
      }
    } else if (newStatus === 'Backlog' || newStatus === 'Wishlist') {
      setStartedReading('');
      setFinishedReading('');
    }
  };

  const handleDateChange = (type: 'started' | 'finished', value: string) => {
    if (type === 'started') {
      setStartedReading(value);
      if (value && (status === 'Backlog' || status === 'Wishlist')) {
        setStatus('Reading');
      }
    } else {
      setFinishedReading(value);
      if (value) {
        setStatus('Read');
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
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
          <h2 className="text-xl sm:text-2xl font-bold text-tzeentch-cyan font-display tracking-tighter">SUMMON KNOWLEDGE</h2>
          <button onClick={handleClose} className="p-2 hover:bg-tzeentch-cyan/10 rounded-full transition-colors">
            <X size={20} className="sm:w-[24px] sm:h-[24px] text-tzeentch-cyan/40" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-tzeentch-bg no-scrollbar">
          {!selectedBook ? (
            <div className="space-y-6">
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
                  placeholder="Search the Warp..."
                  className="w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-4 bg-tzeentch-card border border-tzeentch-cyan/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-tzeentch-cyan/30 font-sans transition-all text-sm sm:text-base text-tzeentch-text placeholder:text-tzeentch-text-faint/80"
                  autoFocus
                />
                <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-tzeentch-cyan/40" size={18} />
                <button 
                  type="submit"
                  disabled={loading}
                  className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 px-3 sm:px-4 py-1.5 sm:py-2 bg-tzeentch-cyan text-tzeentch-bg rounded-lg text-xs sm:text-sm font-bold hover:bg-tzeentch-cyan/80 transition-colors disabled:opacity-50 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : 'DIVINE'}
                </button>
              </form>

              <div className="grid grid-cols-1 gap-4">
                {results.map((result, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setSelectedBook(result);
                      if (result.categories) {
                        setSelectedTags(result.categories.split(',').map(c => c.trim()).filter(Boolean));
                      } else {
                        setSelectedTags([]);
                      }
                      // Auto-set format if source is Audible
                      if (result.metadata_source?.toLowerCase().includes('audible')) {
                        setFormat('Audiobook');
                      }
                    }}
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
                    <p className="text-tzeentch-cyan/40 italic font-sans">The Warp remains silent for "{query}"</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 sm:space-y-8">
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                <div className="w-24 sm:w-32 aspect-[2/3] bg-tzeentch-warp/40 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.5)] flex-shrink-0 border border-tzeentch-cyan/20 mx-auto sm:mx-0">
                  {selectedBook.cover_url ? (
                    <img src={selectedBook.cover_url} alt={selectedBook.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-tzeentch-cyan/10">
                      <BookIcon size={48} />
                    </div>
                  )}
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <button onClick={() => setSelectedBook(null)} className="text-[10px] font-bold text-tzeentch-cyan/40 hover:text-tzeentch-cyan mb-2 uppercase tracking-widest transition-colors">← RE-DIVINE</button>
                  <h3 className="text-xl sm:text-2xl font-bold text-tzeentch-cyan leading-tight mb-1">{selectedBook.title}</h3>
                  <p className="text-base sm:text-lg text-tzeentch-text-muted italic mb-1">{selectedBook.author}</p>
                  {selectedBook.narrator && <p className="text-xs sm:text-sm text-tzeentch-text-faint italic mb-4">Narrated by: {selectedBook.narrator}</p>}
                  
                  <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                    {selectedBook.series && (
                      <span className="px-2 py-1 bg-tzeentch-cyan/5 rounded text-[10px] font-bold uppercase tracking-wider text-tzeentch-cyan border border-tzeentch-cyan/20">
                        Series: {selectedBook.series}
                        {selectedBook.series_number && ` #${selectedBook.series_number}`}
                      </span>
                    )}
                    {selectedBook.pageCount && (
                      <span className="px-2 py-1 bg-tzeentch-cyan/5 rounded text-[10px] font-bold uppercase tracking-wider text-tzeentch-cyan/60 border border-tzeentch-cyan/10">Length: {selectedBook.pageCount}</span>
                    )}
                    {selectedBook.isbn && (
                      <span className="px-2 py-1 bg-tzeentch-cyan/5 rounded text-[10px] font-bold uppercase tracking-wider text-tzeentch-cyan/60 border border-tzeentch-cyan/10">ISBN: {selectedBook.isbn}</span>
                    )}
                    {selectedBook.asin && (
                      <span className="px-2 py-1 bg-tzeentch-cyan/5 rounded text-[10px] font-bold uppercase tracking-wider text-tzeentch-cyan/60 border border-tzeentch-cyan/10">ASIN: {selectedBook.asin}</span>
                    )}
                    {selectedBook.publishedDate && (
                      <span className="px-2 py-1 bg-tzeentch-cyan/5 rounded text-[10px] font-bold uppercase tracking-wider text-tzeentch-cyan/60 border border-tzeentch-cyan/10">Cycle: {selectedBook.publishedDate}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <label className="block text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Destined Shelf</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Reading', 'Read', 'Backlog', 'Wishlist', 'Dropped'] as BookStatus[])
                      .filter(s => viewPreferences?.[s] !== 'disabled')
                      .map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        className={`px-4 py-3 rounded-xl text-sm font-bold transition-all border ${status === s ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'bg-tzeentch-card text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/30'}`}
                      >
                        {s.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Manifestation</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Book', 'Audiobook'] as BookFormat[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFormat(f)}
                        className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all border ${format === f ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'bg-tzeentch-card text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/30'}`}
                      >
                        {f === 'Audiobook' ? <Headphones size={16} /> : <BookIcon size={16} />}
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Started Journey</label>
                    <button 
                      type="button" 
                      onClick={() => handleDateChange('started', new Date().toISOString().split('T')[0])}
                      className="text-[10px] font-bold text-tzeentch-magenta hover:text-tzeentch-cyan transition-colors uppercase tracking-widest"
                    >
                      Today
                    </button>
                  </div>
                  <input 
                    type="text"
                    value={startedReading}
                    onChange={(e) => handleDateChange('started', e.target.value)}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-4 py-3 bg-tzeentch-card border border-tzeentch-cyan/20 rounded-xl text-sm text-tzeentch-text focus:outline-none focus:ring-2 focus:ring-tzeentch-cyan/30"
                  />
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Finished Journey</label>
                    <button 
                      type="button" 
                      onClick={() => handleDateChange('finished', new Date().toISOString().split('T')[0])}
                      className="text-[10px] font-bold text-tzeentch-magenta hover:text-tzeentch-cyan transition-colors uppercase tracking-widest"
                    >
                      Today
                    </button>
                  </div>
                  <input 
                    type="text"
                    value={finishedReading}
                    onChange={(e) => handleDateChange('finished', e.target.value)}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-4 py-3 bg-tzeentch-card border border-tzeentch-cyan/20 rounded-xl text-sm text-tzeentch-text focus:outline-none focus:ring-2 focus:ring-tzeentch-cyan/30"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Arcane Rating</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setRating(star)}
                      className="p-1 transition-transform hover:scale-125"
                    >
                      <Star 
                        size={32} 
                        className={star <= rating ? 'fill-tzeentch-gold text-tzeentch-gold drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'text-tzeentch-text-faint/30'} 
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 relative" ref={dropdownRef}>
                <label className="block text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Arcane Tags</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedTags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-3 py-1 bg-tzeentch-cyan/10 text-tzeentch-cyan text-[10px] font-bold rounded-full border border-tzeentch-cyan/20">
                      {tag.toUpperCase()}
                      <button onClick={() => removeTag(tag)} className="hover:text-tzeentch-magenta transition-colors">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="relative">
                  <input 
                    type="text"
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setIsTagDropdownOpen(true);
                    }}
                    onFocus={() => setIsTagDropdownOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag(tagInput);
                      }
                    }}
                    placeholder="Add tags to the Warp..."
                    className="w-full pl-10 pr-4 py-3 bg-tzeentch-card border border-tzeentch-cyan/20 rounded-xl text-sm text-tzeentch-text focus:outline-none focus:ring-2 focus:ring-tzeentch-cyan/30"
                  />
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-tzeentch-cyan/40" size={18} />
                  {tagInput && (
                    <button 
                      onClick={() => handleAddTag(tagInput)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 bg-tzeentch-cyan text-tzeentch-bg rounded-md hover:bg-tzeentch-cyan/80 transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>

                <AnimatePresence>
                  {isTagDropdownOpen && (availableTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t)).length > 0) && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-10 w-full mt-2 bg-tzeentch-card border border-tzeentch-cyan/20 rounded-xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto"
                    >
                      {availableTags
                        .filter(t => t.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t))
                        .map(tag => (
                          <button
                            key={tag}
                            onClick={() => handleAddTag(tag)}
                            className="w-full text-left px-4 py-3 text-sm text-tzeentch-text/90 hover:bg-tzeentch-cyan/10 hover:text-tzeentch-cyan transition-colors"
                          >
                            {tag}
                          </button>
                        ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedBook && (
          <div className="px-6 sm:px-8 py-4 sm:py-6 border-t border-tzeentch-cyan/10 bg-tzeentch-card/50 backdrop-blur-md flex justify-end gap-3">
            <button 
              onClick={() => setSelectedBook(null)}
              className="px-4 sm:px-6 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-bold text-tzeentch-text-muted hover:text-tzeentch-text transition-colors"
            >
              ABORT
            </button>
            <button 
              onClick={handleAdd}
              className="px-6 sm:px-8 py-2 sm:py-3 bg-tzeentch-cyan text-tzeentch-bg rounded-xl text-xs sm:text-sm font-bold hover:bg-tzeentch-cyan/80 transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)] flex items-center gap-2"
            >
              <Check size={16} className="sm:w-[18px] sm:h-[18px]" />
              BIND TO LIBRARY
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
