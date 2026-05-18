import React, { useState, useEffect, useRef } from 'react';
import { Search, Book as BookIcon } from 'lucide-react';
import { Book } from '../types';

interface GlobalSearchProps {
  onSelectBook: (book: Book) => void;
  isMobile?: boolean;
}

export default function GlobalSearch({ onSelectBook, isMobile }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Book[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    
    const fetchResults = async () => {
      if (!query.trim()) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(`/api/search/global?q=${encodeURIComponent(query)}`, {
          signal: controller.signal
        });
        if (response.ok) {
          const data = await response.json();
          setResults(data);
          setIsOpen(true);
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Search failed:', error);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    const timer = setTimeout(fetchResults, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleSelect = (book: Book) => {
    setQuery('');
    setIsOpen(false);
    onSelectBook(book);
  };

  if (isMobile) {
    return (
      <div className="relative group md:hidden" ref={wrapperRef}>
        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none z-10">
          <Search size={14} className="text-tzeentch-cyan/40" />
        </div>
        <input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          className="w-32 sm:w-48 bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-lg py-1 pl-7 pr-2 text-xs text-tzeentch-text focus:outline-none focus:border-tzeentch-cyan/50 transition-all z-10 relative"
          onFocus={() => query.trim() && setIsOpen(true)}
        />
        {isOpen && query.trim() && (
          <div className="absolute right-0 mt-2 w-[85vw] max-w-xs max-h-96 overflow-y-auto bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-xl shadow-[0_4px_20px_rgba(34,211,238,0.2)] z-50">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-tzeentch-cyan/60">Searching...</div>
            ) : results.length > 0 ? (
              <ul className="py-2">
                {results.map((book) => (
                  <li key={book.id}>
                    <button
                      onClick={() => handleSelect(book)}
                      className="w-full text-left px-4 py-2 hover:bg-tzeentch-cyan/10 flex items-center gap-3 transition-colors"
                    >
                      {book.cover_url ? (
                        <img src={book.cover_url} alt="" className="w-8 h-12 object-cover rounded shadow" />
                      ) : (
                        <div className="w-8 h-12 bg-tzeentch-cyan/10 flex items-center justify-center rounded shadow">
                          <BookIcon size={16} className="text-tzeentch-cyan/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-tzeentch-cyan truncate">{book.title}</div>
                        <div className="text-xs text-tzeentch-text/70 truncate">{book.author}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-center text-sm text-tzeentch-cyan/60">No books found.</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="hidden md:block flex-1 max-w-md mx-4" ref={wrapperRef}>
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
          <Search size={16} className="text-tzeentch-cyan/40 group-focus-within:text-tzeentch-cyan transition-colors" />
        </div>
        <input
          type="text"
          placeholder="Search library..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          className="w-full bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-lg py-1.5 pl-9 pr-3 text-sm text-tzeentch-text placeholder-tzeentch-cyan/30 focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all z-10 relative"
          onFocus={() => query.trim() && setIsOpen(true)}
        />
        {isOpen && query.trim() && (
          <div className="absolute top-full left-0 right-0 mt-2 max-h-96 overflow-y-auto bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-xl shadow-[0_4px_20px_rgba(34,211,238,0.2)] z-50">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-tzeentch-cyan/60">Searching...</div>
            ) : results.length > 0 ? (
              <ul className="py-2">
                {results.map((book) => (
                  <li key={book.id}>
                    <button
                      onClick={() => handleSelect(book)}
                      className="w-full text-left px-4 py-2 hover:bg-tzeentch-cyan/10 flex items-center gap-3 transition-colors"
                    >
                      {book.cover_url ? (
                        <img src={book.cover_url} alt="" className="w-10 h-14 object-cover rounded shadow" />
                      ) : (
                        <div className="w-10 h-14 bg-tzeentch-cyan/10 flex items-center justify-center rounded shadow">
                          <BookIcon size={20} className="text-tzeentch-cyan/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-tzeentch-cyan truncate">{book.title}</div>
                        <div className="text-xs text-tzeentch-text/70 truncate">{book.author}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-center text-sm text-tzeentch-cyan/60">No books found.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
