/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Book, BookStatus, UIConfig } from './types';
import { BookOpen, Library, Bookmark, CheckCircle, Plus, Search, Settings, Info, BarChart2, RefreshCw, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import BookCard from './components/BookCard';
import BookList from './components/BookList';
import OverviewPanel from './components/OverviewPanel';
import AddBookModal from './components/AddBookModal';
import BookDetailsModal from './components/BookDetailsModal';
import SettingsModal from './components/SettingsModal';
import BulkEditModal from './components/BulkEditModal';
import BulkDeleteConfirmModal from './components/BulkDeleteConfirmModal';
import AboutModal from './components/AboutModal';
import RefreshMetadataModal from './components/RefreshMetadataModal';
import ManualRefreshModal from './components/ManualRefreshModal';
import AbsSyncModal from './components/AbsSyncModal';

type TabType = BookStatus | 'Overview';

const TABS: { id: TabType; label: string; icon: any }[] = [
  { id: 'Overview', label: 'Overview', icon: BarChart2 },
  { id: 'Reading', label: 'Reading', icon: BookOpen },
  { id: 'Read', label: 'Read', icon: CheckCircle },
  { id: 'Backlog', label: 'Backlog', icon: Library },
  { id: 'Wishlist', label: 'Wishlist', icon: Bookmark },
  { id: 'Dropped', label: 'Dropped', icon: XCircle },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('Overview');
  const [uiConfig, setUiConfig] = useState<UIConfig | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [allBooks, setAllBooks] = useState<Book[]>([]);

  const viewType = activeTab !== 'Overview' ? (uiConfig?.viewPreferences?.[activeTab as BookStatus] || 'cards') : 'cards';

  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<number[]>([]);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isRefreshMetadataModalOpen, setIsRefreshMetadataModalOpen] = useState(false);
  const [isAbsSyncModalOpen, setIsAbsSyncModalOpen] = useState(false);

  const fetchBooks = async () => {
    setLoading(true);
    try {
      let data = [];
      if (activeTab === 'Read' && uiConfig?.viewPreferences?.['Dropped'] === 'show-with-read') {
        const [readRes, droppedRes] = await Promise.all([
          fetch('/api/books?status=Read'),
          fetch('/api/books?status=Dropped')
        ]);
        const readData = await readRes.json();
        const droppedData = await droppedRes.json();
        data = [...readData, ...droppedData];
      } else {
        const response = await fetch(`/api/books?status=${activeTab}`);
        data = await response.json();
      }
      setBooks(data);
    } catch (error) {
      console.error('Failed to fetch books:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUIConfig = async () => {
    try {
      const response = await fetch('/api/ui-config');
      const data = await response.json();
      setUiConfig(data);
    } catch (error) {
      console.error('Failed to fetch UI config:', error);
    }
  };

  const fetchInitialTab = async () => {
    try {
      const res = await fetch('/api/last-active-tab');
      const data = await res.json();
      if (data.lastActiveTab) {
        setActiveTab(data.lastActiveTab);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchInitialTab();
    fetchUIConfig();
  }, []);

  useEffect(() => {
    if (activeTab) {
      fetch('/api/last-active-tab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: activeTab })
      }).catch(() => {});
    }
  }, [activeTab]);

  useEffect(() => {
    if (uiConfig && activeTab !== 'Overview') {
      const pref = uiConfig.viewPreferences?.[activeTab as BookStatus];
      if (pref === 'disabled' || (activeTab === 'Dropped' && pref === 'show-with-read')) {
        setActiveTab('Overview');
      }
    }
  }, [uiConfig, activeTab]);

  useEffect(() => {
    const applyTheme = () => {
      const theme = uiConfig?.theme || 'system';
      const root = document.documentElement;
      
      if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme();
    
    if (!uiConfig || uiConfig.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [uiConfig?.theme]);

  useEffect(() => {
    fetchBooks();
  }, [activeTab]);

  const handleBookUpdate = (updatedBook?: Book) => {
    fetchBooks();
    if (updatedBook && selectedBook && updatedBook.id === selectedBook.id) {
      setSelectedBook(updatedBook);
    }
  };

  const sortedBooks = React.useMemo(() => {
    const sortFields = uiConfig?.sortFields && uiConfig.sortFields.length > 0 
      ? uiConfig.sortFields 
      : [
          { id: 'finished_reading', direction: 'desc' },
          { id: 'started_reading', direction: 'desc' },
          { id: 'author', direction: 'asc' }
        ];
    
    return [...books].sort((a, b) => {
      for (const sort of sortFields) {
        let valA = a[sort.id as keyof Book];
        let valB = b[sort.id as keyof Book];
        
        if (sort.id === 'series') {
          // Combine series and series_number for sorting
          valA = a.series ? `${a.series} ${a.series_number || ''}`.trim() : undefined;
          valB = b.series ? `${b.series} ${b.series_number || ''}`.trim() : undefined;
        }
        
        if (valA === valB) continue;
        
        // Handle empty values (always put empty values at the top)
        const isEmpty = (v: any) => v === null || v === undefined || v === '';
        if (isEmpty(valA) && !isEmpty(valB)) return -1;
        if (!isEmpty(valA) && isEmpty(valB)) return 1;
        
        // Compare values
        let aCmp = valA;
        let bCmp = valB;
        if (typeof aCmp === 'string') aCmp = aCmp.toLowerCase();
        if (typeof bCmp === 'string') bCmp = bCmp.toLowerCase();

        if (aCmp! < bCmp!) return sort.direction === 'asc' ? -1 : 1;
        if (aCmp! > bCmp!) return sort.direction === 'asc' ? 1 : -1;
      }
      return b.id - a.id; // fallback to newest first
    });
  }, [books, uiConfig?.sortFields]);

  const filteredBooks = React.useMemo(() => {
    if (!searchQuery.trim()) return sortedBooks;
    
    const searchTerms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    
    return sortedBooks.filter(book => {
      // Create a single string containing all searchable text for this book
      const searchableText = Object.values(book)
        .filter(val => val !== null && val !== undefined)
        .map(val => String(val).toLowerCase())
        .join(' ');
        
      // Check if ALL search terms are present anywhere in the searchable text
      return searchTerms.every(term => searchableText.includes(term));
    });
  }, [sortedBooks, searchQuery]);

  const handleToggleSelection = (id: number) => {
    setSelectedBookIds(prev => 
      prev.includes(id) ? prev.filter(bookId => bookId !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen text-tzeentch-text font-sans selection:bg-tzeentch-cyan/30">
      {/* Header */}
      <header className="sticky top-0 z-10 glass-tzeentch border-b border-tzeentch-cyan/20 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center">
              <img 
                src="/tzeentch.png" 
                alt="Tzeentch Logo" 
                className="w-full h-full object-contain" 
                referrerPolicy="no-referrer" 
              />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tighter text-tzeentch-cyan font-display">Tzeentch</h1>
          </div>

          {/* Search Field - Desktop */}
          <div className="hidden md:block flex-1 max-w-md mx-4">
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-tzeentch-cyan/40 group-focus-within:text-tzeentch-cyan transition-colors" />
              </div>
              <input
                type="text"
                placeholder="Search library..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-lg py-1.5 pl-9 pr-3 text-sm text-tzeentch-text placeholder-tzeentch-cyan/30 focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Search Field - Mobile Only */}
            <div className="relative group md:hidden">
              <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                <Search size={14} className="text-tzeentch-cyan/40" />
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-24 sm:w-32 bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-lg py-1 pl-7 pr-2 text-xs text-tzeentch-text focus:outline-none focus:border-tzeentch-cyan/50 transition-all"
              />
            </div>

            {uiConfig?.absIntegrationEnabled && (
              <button
                onClick={() => setIsAbsSyncModalOpen(true)}
                className="p-1.5 sm:p-2 rounded-lg border border-tzeentch-cyan/20 hover:bg-tzeentch-cyan/10 transition-all text-tzeentch-cyan"
                title="Sync with Audiobookshelf"
              >
                <RefreshCw size={16} className="sm:w-[18px] sm:h-[18px]" />
              </button>
            )}

            <button
              onClick={() => {
                setIsMultiSelectMode(!isMultiSelectMode);
                setSelectedBookIds([]);
              }}
              className={`p-1.5 sm:p-2 rounded-lg border transition-all ${isMultiSelectMode ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 'border-tzeentch-cyan/20 hover:bg-tzeentch-cyan/10 text-tzeentch-cyan'}`}
              title="Multi-Select Mode"
            >
              <CheckCircle size={16} className="sm:w-[18px] sm:h-[18px]" />
            </button>

            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-1.5 sm:p-2 rounded-lg border border-tzeentch-cyan/20 hover:bg-tzeentch-cyan/10 transition-all text-tzeentch-cyan"
              title="Settings"
            >
              <Settings size={16} className="sm:w-[18px] sm:h-[18px]" />
            </button>

            <button
              onClick={() => setIsAboutModalOpen(true)}
              className="p-1.5 sm:p-2 rounded-lg border border-tzeentch-cyan/20 hover:bg-tzeentch-cyan/10 transition-all text-tzeentch-cyan"
              title="About"
            >
              <Info size={16} className="sm:w-[18px] sm:h-[18px]" />
            </button>

            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-tzeentch-cyan text-tzeentch-bg hover:bg-tzeentch-cyan/80 transition-all text-xs sm:text-sm font-bold shadow-[0_0_20px_rgba(34,211,238,0.3)]"
            >
              <Plus size={14} className="sm:w-[16px] sm:h-[16px]" />
              <span className="hidden sm:inline">Add Tome</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {/* Tabs */}
        <div className="flex gap-1.5 sm:gap-2 mb-8 bg-tzeentch-card/50 p-1 rounded-xl w-full sm:w-fit mx-auto border border-tzeentch-cyan/10 overflow-x-auto no-scrollbar">
          {TABS.filter(tab => 
            tab.id === 'Overview' || 
            (uiConfig?.viewPreferences?.[tab.id as BookStatus] !== 'disabled' && 
             (tab.id !== 'Dropped' || uiConfig?.viewPreferences?.['Dropped'] !== 'show-with-read'))
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <React.Fragment key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center justify-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all duration-300 text-[10px] sm:text-sm font-bold tracking-wide whitespace-nowrap flex-1 sm:flex-none
                    ${isActive 
                      ? 'bg-tzeentch-cyan text-tzeentch-bg shadow-[0_0_15px_rgba(34,211,238,0.5)]' 
                      : 'text-tzeentch-cyan/40 hover:text-tzeentch-cyan hover:bg-tzeentch-cyan/5'}
                  `}
                >
                  <Icon size={16} className="sm:w-[18px] sm:h-[18px]" />
                  <span>{tab.label.toUpperCase()}</span>
                </button>
                {tab.id === 'Overview' && (
                  <div className="w-px h-6 bg-tzeentch-cyan/20 self-center mx-1 hidden sm:block" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Content */}
        <div className="relative min-h-[400px] pb-24">
          <AnimatePresence mode="wait">
            {loading || !uiConfig ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 gap-4"
              >
                <div className="w-12 h-12 border-4 border-tzeentch-cyan/20 border-t-tzeentch-cyan rounded-full animate-spin shadow-[0_0_15px_rgba(34,211,238,0.2)]"></div>
                <p className="text-tzeentch-cyan/60 italic font-medium tracking-widest animate-pulse">DIVINING THE ARCHIVES...</p>
              </motion.div>
            ) : activeTab === 'Overview' ? (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <OverviewPanel books={books} viewPreferences={uiConfig?.viewPreferences} />
              </motion.div>
            ) : filteredBooks.length > 0 ? (
              <motion.div 
                key={`${activeTab}-${viewType}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {viewType === 'cards' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                    {filteredBooks.map((book) => (
                      <BookCard 
                        key={book.id} 
                        book={book} 
                        onUpdate={handleBookUpdate} 
                        onClick={() => setSelectedBook(book)} 
                        fields={(uiConfig?.cardFields || []).filter(f => f !== 'series_number')} 
                        isMultiSelectMode={isMultiSelectMode}
                        isSelected={selectedBookIds.includes(book.id)}
                        onToggleSelection={() => handleToggleSelection(book.id)}
                        viewPreferences={uiConfig?.viewPreferences}
                      />
                    ))}
                  </div>
                ) : (
                  <BookList 
                    books={filteredBooks} 
                    onBookClick={(book) => setSelectedBook(book)} 
                    onUpdate={handleBookUpdate}
                    columns={(uiConfig?.listColumns || []).filter(c => c !== 'series_number')} 
                    isMultiSelectMode={isMultiSelectMode}
                    selectedBookIds={selectedBookIds}
                    onToggleSelection={handleToggleSelection}
                    viewPreferences={uiConfig?.viewPreferences}
                  />
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 text-center"
              >
                <div className="w-20 h-20 bg-tzeentch-cyan/5 rounded-full flex items-center justify-center text-tzeentch-cyan/20 mb-6 border border-tzeentch-cyan/10">
                  <Library size={40} />
                </div>
                <h3 className="text-xl font-bold text-tzeentch-cyan mb-2 tracking-tight">THE SHELF IS VOID</h3>
                <p className="text-tzeentch-text-muted max-w-xs text-sm">
                  Add new knowledge to the Great Library of Tzeentch.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {isMultiSelectMode && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-40 p-4 pointer-events-none"
          >
            <div className="max-w-4xl mx-auto glass-tzeentch border border-tzeentch-cyan/30 rounded-2xl p-4 flex items-center justify-between shadow-[0_0_30px_rgba(34,211,238,0.2)] pointer-events-auto">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-tzeentch-cyan/10 rounded-full flex items-center justify-center text-tzeentch-cyan border border-tzeentch-cyan/20">
                  <CheckCircle size={20} />
                </div>
                <div>
                  <p className="text-sm font-bold text-tzeentch-text">{selectedBookIds.length} Selected</p>
                  <p className="text-xs text-tzeentch-cyan/60 uppercase tracking-widest">Multi-Select Mode</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (selectedBookIds.length === filteredBooks.length) {
                      setSelectedBookIds([]);
                    } else {
                      setSelectedBookIds(filteredBooks.map(b => b.id));
                    }
                  }}
                  className="px-4 py-2 text-sm font-bold text-tzeentch-cyan/60 hover:text-tzeentch-cyan transition-colors"
                >
                  {selectedBookIds.length === filteredBooks.length ? 'Deselect All' : 'Select All'}
                </button>
                
                <div className="w-px h-8 bg-tzeentch-cyan/20 mx-2"></div>
                
                <button
                  onClick={() => setIsBulkEditModalOpen(true)}
                  disabled={selectedBookIds.length === 0}
                  className="px-4 py-2 bg-tzeentch-card border border-tzeentch-cyan/20 hover:border-tzeentch-cyan/50 text-tzeentch-text text-sm font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Edit Selected
                </button>

                <button
                  onClick={() => setIsRefreshMetadataModalOpen(true)}
                  disabled={selectedBookIds.length === 0}
                  className="px-4 py-2 bg-tzeentch-cyan/10 border border-tzeentch-cyan/30 hover:bg-tzeentch-cyan/20 text-tzeentch-cyan text-sm font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Refresh Metadata
                </button>
                
                <button
                  onClick={() => setIsBulkDeleteModalOpen(true)}
                  disabled={selectedBookIds.length === 0}
                  className="px-4 py-2 bg-tzeentch-magenta/20 border border-tzeentch-magenta/40 hover:bg-tzeentch-magenta/30 text-tzeentch-magenta text-sm font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete Selected
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AddBookModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        onSuccess={handleBookUpdate}
        viewPreferences={uiConfig?.viewPreferences}
      />
      <BookDetailsModal 
        book={selectedBook} 
        onClose={() => setSelectedBook(null)} 
        onUpdate={handleBookUpdate} 
        viewPreferences={uiConfig?.viewPreferences}
      />
      <BulkEditModal
        isOpen={isBulkEditModalOpen}
        onClose={() => setIsBulkEditModalOpen(false)}
        selectedIds={selectedBookIds}
        onSuccess={() => {
          fetchBooks();
          setSelectedBookIds([]);
          setIsMultiSelectMode(false);
        }}
        viewPreferences={uiConfig?.viewPreferences}
      />
      <BulkDeleteConfirmModal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => setIsBulkDeleteModalOpen(false)}
        count={selectedBookIds.length}
        onConfirm={async () => {
          try {
            await fetch('/api/books', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: selectedBookIds })
            });
            fetchBooks();
            setSelectedBookIds([]);
            setIsMultiSelectMode(false);
          } catch (error) {
            console.error('Failed to bulk delete:', error);
          }
        }}
      />
      {isRefreshMetadataModalOpen && selectedBookIds.length === 1 ? (
        <ManualRefreshModal
          isOpen={isRefreshMetadataModalOpen}
          onClose={() => setIsRefreshMetadataModalOpen(false)}
          book={books.find(b => b.id === selectedBookIds[0])!}
          onSuccess={() => {
            fetchBooks();
            setSelectedBookIds([]);
            setIsMultiSelectMode(false);
            setIsRefreshMetadataModalOpen(false);
          }}
        />
      ) : isRefreshMetadataModalOpen && (
        <RefreshMetadataModal
          isOpen={isRefreshMetadataModalOpen}
          onClose={() => setIsRefreshMetadataModalOpen(false)}
          selectedIds={selectedBookIds}
          onSuccess={() => {
            fetchBooks();
            setSelectedBookIds([]);
            setIsMultiSelectMode(false);
          }}
        />
      )}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />
      {isSettingsModalOpen && uiConfig && (
        <SettingsModal
          onClose={() => setIsSettingsModalOpen(false)}
          config={uiConfig}
          onSave={async (newConfig) => {
            try {
              const res = await fetch('/api/ui-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
              });
              if (res.ok) {
                setUiConfig(newConfig);
                setIsSettingsModalOpen(false);
              }
            } catch (error) {
              console.error('Failed to save UI config:', error);
            }
          }}
          onImportSuccess={handleBookUpdate}
        />
      )}
      {isAbsSyncModalOpen && uiConfig && (
        <AbsSyncModal
          config={uiConfig}
          onClose={() => setIsAbsSyncModalOpen(false)}
          onConfigChange={(newConfig) => setUiConfig(newConfig)}
          onSyncComplete={fetchBooks}
        />
      )}
    </div>
  );
}
