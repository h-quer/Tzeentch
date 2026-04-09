import React, { useState, useRef, useEffect } from 'react';
import { Book, BookStatus } from '../types';
import { Star, Headphones, Book as BookIcon, CheckCircle, MoreHorizontal, BookOpen, Library, Bookmark, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AVAILABLE_FIELDS } from './SettingsModal';
import RefreshMetadataModal from './RefreshMetadataModal';
import ManualRefreshModal from './ManualRefreshModal';
import ConfirmModal from './ConfirmModal';

interface BookListProps {
  books: Book[];
  onBookClick: (book: Book) => void;
  onUpdate: () => void;
  columns: string[];
  isMultiSelectMode?: boolean;
  selectedBookIds?: number[];
  onToggleSelection?: (bookId: number) => void;
  viewPreferences?: Record<string, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

interface BookListRowProps {
  book: Book;
  onBookClick: (book: Book) => void;
  onUpdate: () => void;
  columns: string[];
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (bookId: number) => void;
  viewPreferences?: Record<string, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
}

const BookListRow: React.FC<BookListRowProps> = React.memo(({ book, onBookClick, onUpdate, columns, isMultiSelectMode, isSelected, onToggleSelection, viewPreferences }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRefreshModalOpen, setIsRefreshModalOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handleScroll = () => {
      if (isMenuOpen) setIsMenuOpen(false);
    };

    if (isMenuOpen) {
      window.addEventListener('scroll', handleScroll, true);
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPosition({
          top: rect.top + rect.height / 2,
          left: rect.left - 8,
        });
      }
    }

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isMenuOpen]);

  const [statusConfirm, setStatusConfirm] = useState<{isOpen: boolean, newStatus: BookStatus | null, message: string}>({isOpen: false, newStatus: null, message: ''});

  const handleStatusChangeClick = (newStatus: BookStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentStatus = book.status;
    if (currentStatus === 'Read' && (newStatus === 'Backlog' || newStatus === 'Wishlist')) {
      setStatusConfirm({
        isOpen: true,
        newStatus,
        message: 'Moving this book to Backlog or Wishlist will remove its started and finished reading dates. Are you sure you want to proceed?'
      });
      return;
    } else if (currentStatus === 'Read' && newStatus === 'Reading') {
      setStatusConfirm({
        isOpen: true,
        newStatus,
        message: 'Moving this book to Reading will remove its finished reading date. Are you sure you want to proceed?'
      });
      return;
    } else if (currentStatus === 'Reading' && (newStatus === 'Backlog' || newStatus === 'Wishlist')) {
      setStatusConfirm({
        isOpen: true,
        newStatus,
        message: 'Moving this book to Backlog or Wishlist will remove its started reading date. Are you sure you want to proceed?'
      });
      return;
    }
    
    updateStatus(newStatus);
  };

  const updateStatus = async (newStatus: BookStatus) => {
    const today = new Date().toISOString().split('T')[0];
    const updates: any = { status: newStatus };
    const currentStatus = book.status;
    
    if (newStatus === 'Reading') {
      if (currentStatus !== 'Dropped') {
        updates.finished_reading = '';
        if (currentStatus === 'Backlog' || currentStatus === 'Wishlist') {
          updates.started_reading = today;
        } else if (!book.started_reading) {
          updates.started_reading = today;
        }
      }
    } else if (newStatus === 'Read') {
      if (currentStatus === 'Backlog' || currentStatus === 'Wishlist') {
        updates.started_reading = today;
        updates.finished_reading = today;
      } else if (currentStatus === 'Reading') {
        // started_reading stays the same
        updates.finished_reading = today;
      } else if (currentStatus === 'Dropped') {
        if (!book.finished_reading) updates.finished_reading = today;
      } else {
        if (!book.finished_reading) updates.finished_reading = today;
        if (!book.started_reading) updates.started_reading = today;
      }
    } else if (newStatus === 'Backlog' || newStatus === 'Wishlist') {
      if (currentStatus !== 'Dropped') {
        updates.started_reading = '';
        updates.finished_reading = '';
      }
    }

    try {
      await fetch(`/api/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      onUpdate();
      setIsMenuOpen(false);
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setStatusConfirm({isOpen: false, newStatus: null, message: ''});
    }
  };

  const removeBook = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await fetch(`/api/books/${book.id}`, { method: 'DELETE' });
      onUpdate();
      setIsConfirmingDelete(false);
    } catch (error) {
      console.error('Failed to delete book:', error);
    }
  };

  const renderCell = (book: Book, col: string) => {
    switch (col) {
      case 'title':
        return (
          <div className="flex items-center gap-3">
            <div className="w-10 h-14 bg-tzeentch-warp/40 rounded shadow-lg overflow-hidden flex-shrink-0 border border-tzeentch-cyan/10">
              {book.cover_url ? (
                <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-tzeentch-cyan/10">
                  <BookIcon size={16} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-tzeentch-cyan group-hover:text-tzeentch-cyan transition-colors line-clamp-2 break-words" title={book.title}>{book.title}</p>
              <p className="text-xs text-tzeentch-text-faint sm:hidden line-clamp-1">{book.author}</p>
            </div>
          </div>
        );
      case 'author':
        return <p className="text-sm text-tzeentch-text-muted font-medium line-clamp-2 max-w-[150px] break-words" title={book.author}>{book.author}</p>;
      case 'narrator':
        return <p className="text-sm text-tzeentch-text-faint font-medium line-clamp-2 max-w-[120px] break-words" title={book.narrator}>{book.narrator || '—'}</p>;
      case 'series':
        return (
          <p className="text-sm text-tzeentch-cyan/80 font-medium line-clamp-2 max-w-[150px] break-words" title={book.series}>
            {book.series || '—'}
            {book.series && book.series_number && ` #${book.series_number}`}
          </p>
        );
      case 'rating':
        return (
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star 
                key={star} 
                size={12} 
                className={star <= (book.rating || 0) ? 'fill-tzeentch-gold text-tzeentch-gold' : 'text-tzeentch-text-faint/30'} 
              />
            ))}
          </div>
        );
      case 'format':
        return (
          <div className="flex items-center gap-2 text-xs font-bold text-tzeentch-cyan">
            {book.format === 'Audiobook' ? <Headphones size={14} /> : <BookIcon size={14} />}
            <span>{book.format.toUpperCase()}</span>
          </div>
        );
      case 'status':
        return <span className="text-xs font-bold text-tzeentch-text-muted uppercase tracking-widest">{book.status}</span>;
      case 'started_reading':
        return <span className="text-xs font-bold text-tzeentch-text-faint uppercase tracking-widest">{book.started_reading || '—'}</span>;
      case 'finished_reading':
        return <span className="text-xs font-bold text-tzeentch-text-faint/80 uppercase tracking-widest">{book.finished_reading || '—'}</span>;
      case 'page_count':
        return <span className="text-sm text-tzeentch-text-muted">{book.page_count || '—'}</span>;
      case 'published_date':
        return <span className="text-sm text-tzeentch-text-muted">{book.published_date || '—'}</span>;
      case 'publisher':
        return <span className="text-sm text-tzeentch-text-muted line-clamp-2 max-w-[120px] break-words" title={book.publisher}>{book.publisher || '—'}</span>;
      case 'tags':
        if (!book.tags) return <span className="text-xs text-tzeentch-text-faint">—</span>;
        const uniqueTags = Array.from(new Set<string>(book.tags.split(',').map(t => t.trim()).filter(Boolean)));
        return (
          <div className="flex flex-wrap gap-1 max-w-[150px]">
            {uniqueTags.map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-tzeentch-cyan/10 text-tzeentch-cyan text-[9px] font-bold rounded border border-tzeentch-cyan/20 truncate max-w-full" title={tag}>
                {tag.toUpperCase()}
              </span>
            ))}
          </div>
        );
      case 'isbn':
        return <span className="text-xs font-mono text-tzeentch-text-faint line-clamp-2 max-w-[100px] break-all">{book.isbn || book.asin || '—'}</span>;
      case 'description':
        return <p className="text-xs text-tzeentch-text-faint line-clamp-2 max-w-[200px] break-words" title={book.description}>{book.description || '—'}</p>;
      case 'metadata_source':
        return (
          book.metadata_source ? (
            <a href={book.metadata_source} target="_blank" rel="noopener noreferrer" className="text-xs text-tzeentch-cyan hover:underline line-clamp-1 max-w-[150px]" title={book.metadata_source}>
              Link
            </a>
          ) : <span className="text-xs text-tzeentch-text-faint">—</span>
        );
      case 'notes':
        return <p className="text-xs text-tzeentch-text-faint line-clamp-2 max-w-[200px] break-words" title={book.notes}>{book.notes || '—'}</p>;
      default:
        return null;
    }
  };

  return (
    <motion.tr 
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => {
        if (isMultiSelectMode && onToggleSelection) {
          onToggleSelection(book.id);
        } else {
          onBookClick(book);
        }
      }}
      className={`group cursor-pointer transition-colors border-b border-tzeentch-cyan/5 last:border-0 relative ${isSelected ? 'bg-tzeentch-cyan/10' : 'hover:bg-tzeentch-cyan/5'}`}
    >
      {isMultiSelectMode && (
        <td className="px-4 py-3 align-middle">
          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-tzeentch-cyan border-tzeentch-cyan text-tzeentch-bg' : 'border-tzeentch-cyan/40 bg-tzeentch-bg/50'}`}>
            {isSelected && <CheckCircle size={12} />}
          </div>
        </td>
      )}
      {columns.map(col => (
        <td key={col} className="px-4 py-3 align-middle">
          {renderCell(book, col)}
        </td>
      ))}
      <td className="px-4 py-3 align-middle text-right">
        <button 
          ref={buttonRef}
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          className="p-2 rounded-full hover:bg-tzeentch-cyan/10 text-tzeentch-cyan/40 hover:text-tzeentch-cyan transition-colors"
        >
          <MoreHorizontal size={18} />
        </button>

        {/* Context Menu */}
        {isMenuOpen && (
          <>
            <div 
              className="fixed inset-0 z-10" 
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
              }} 
            />
            <div 
              onClick={(e) => e.stopPropagation()}
              style={{ top: menuPosition.top, left: menuPosition.left }}
              className="fixed -translate-x-full -translate-y-1/2 z-20 bg-tzeentch-bg rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-tzeentch-cyan/30 p-2 min-w-[160px] animate-in fade-in zoom-in duration-200 backdrop-blur-xl text-left"
            >
              <p className="text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-widest px-3 py-2">Alter Fate</p>
              {viewPreferences?.['Reading'] !== 'disabled' && (
                <button onClick={(e) => handleStatusChangeClick('Reading', e)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-tzeentch-cyan/10 text-sm font-bold text-tzeentch-cyan transition-colors">
                  <BookOpen size={16} /> Reading
                </button>
              )}
              {viewPreferences?.['Read'] !== 'disabled' && (
                <button onClick={(e) => handleStatusChangeClick('Read', e)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-tzeentch-cyan/10 text-sm font-bold text-tzeentch-cyan transition-colors">
                  <CheckCircle size={16} /> Read
                </button>
              )}
              {viewPreferences?.['Backlog'] !== 'disabled' && (
                <button onClick={(e) => handleStatusChangeClick('Backlog', e)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-tzeentch-cyan/10 text-sm font-bold text-tzeentch-cyan transition-colors">
                  <Library size={16} /> Backlog
                </button>
              )}
              {viewPreferences?.['Wishlist'] !== 'disabled' && (
                <button onClick={(e) => handleStatusChangeClick('Wishlist', e)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-tzeentch-cyan/10 text-sm font-bold text-tzeentch-cyan transition-colors">
                  <Bookmark size={16} /> Wishlist
                </button>
              )}
              {viewPreferences?.['Dropped'] !== 'disabled' && (
                <button onClick={(e) => handleStatusChangeClick('Dropped', e)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-tzeentch-cyan/10 text-sm font-bold text-tzeentch-cyan transition-colors">
                  <XCircle size={16} /> Dropped
                </button>
              )}
              <div className="h-px bg-tzeentch-cyan/10 my-1" />
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsRefreshModalOpen(true);
                  setIsMenuOpen(false);
                }} 
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-tzeentch-cyan/10 text-sm font-bold text-tzeentch-cyan transition-colors"
              >
                <RefreshCw size={16} /> Refresh Metadata
              </button>
              <div className="h-px bg-tzeentch-cyan/10 my-1" />
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsConfirmingDelete(true);
                  setIsMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-900/30 text-sm font-bold text-red-400 transition-colors"
              >
                <Trash2 size={16} /> Banish
              </button>
            </div>
          </>
        )}

        {/* Delete Confirmation Overlay */}
        <AnimatePresence>
          {isConfirmingDelete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-tzeentch-bg/95 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 size={32} className="text-red-500 mb-2" />
              <p className="text-xs font-bold text-tzeentch-cyan uppercase tracking-widest mb-4">Banish this tome?</p>
              <div className="flex gap-2 w-full max-w-[200px]">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConfirmingDelete(false);
                  }}
                  className="flex-1 py-2 rounded-lg bg-tzeentch-card text-tzeentch-text-muted text-[10px] font-bold uppercase tracking-widest border border-tzeentch-cyan/10"
                >
                  Abort
                </button>
                <button 
                  onClick={(e) => removeBook(e)}
                  className="flex-1 py-2 rounded-lg bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(220,38,38,0.4)]"
                >
                  Banish
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isRefreshModalOpen && (
          <ManualRefreshModal
            isOpen={isRefreshModalOpen}
            onClose={() => setIsRefreshModalOpen(false)}
            book={book}
            onSuccess={() => {
              onUpdate();
              setIsRefreshModalOpen(false);
            }}
          />
        )}
        <ConfirmModal 
          isOpen={statusConfirm.isOpen}
          title="Alter Destiny?"
          message={statusConfirm.message}
          confirmText="Proceed"
          onConfirm={() => {
            if (statusConfirm.newStatus) {
              updateStatus(statusConfirm.newStatus);
            }
          }}
          onCancel={() => setStatusConfirm({isOpen: false, newStatus: null, message: ''})}
        />
      </td>
    </motion.tr>
  );
});

export default function BookList({ books, onBookClick, onUpdate, columns, isMultiSelectMode, selectedBookIds, onToggleSelection, viewPreferences, onLoadMore, hasMore }: BookListProps) {
  const observerTarget = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!onLoadMore || !hasMore) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [onLoadMore, hasMore]);

  return (
    <div className="bg-tzeentch-card/30 rounded-2xl border border-tzeentch-cyan/10 overflow-auto max-h-[calc(100vh-220px)] relative no-scrollbar">
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-20 bg-tzeentch-card/95 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
          <tr className="border-b border-tzeentch-cyan/10">
            {isMultiSelectMode && (
              <th className="px-4 py-3 w-10"></th>
            )}
            {columns.map(col => {
              const fieldDef = AVAILABLE_FIELDS.find(f => f.id === col);
              return (
                <th key={col} className="px-4 py-3 text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-[0.1em]">
                  {fieldDef?.label || col}
                </th>
              );
            })}
            <th className="px-4 py-3 text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-[0.1em] text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <BookListRow 
              key={book.id}
              book={book}
              onBookClick={onBookClick}
              onUpdate={onUpdate}
              columns={columns}
              isMultiSelectMode={isMultiSelectMode}
              isSelected={selectedBookIds?.includes(book.id)}
              onToggleSelection={onToggleSelection}
              viewPreferences={viewPreferences}
            />
          ))}
          {hasMore && (
            <tr ref={observerTarget}>
              <td colSpan={columns.length + 2} className="h-20 text-center">
                <div className="w-6 h-6 border-2 border-tzeentch-cyan/20 border-t-tzeentch-cyan rounded-full animate-spin mx-auto"></div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
