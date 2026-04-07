import { Book, BookStatus } from '../types';
import { Star, MoreHorizontal, Trash2, CheckCircle, BookOpen, Library, Bookmark, Headphones, Book as BookIcon, RefreshCw, XCircle } from 'lucide-react';
import React, { useState, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import RefreshMetadataModal from './RefreshMetadataModal';
import ManualRefreshModal from './ManualRefreshModal';
import ConfirmModal from './ConfirmModal';

interface BookCardProps {
  book: Book;
  onUpdate: () => void;
  onClick: () => void;
  fields: string[];
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: () => void;
  viewPreferences?: Record<string, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
}

const BookCard: React.FC<BookCardProps> = memo(({ book, onUpdate, onClick, fields, isMultiSelectMode, isSelected, onToggleSelection, viewPreferences }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRefreshModalOpen, setIsRefreshModalOpen] = useState(false);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

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

  const renderField = (field: string, isLast: boolean) => {
    const marginClass = isLast ? 'mt-auto' : 'mb-2';
    switch (field) {
      case 'title':
        return <h3 key={field} className={`font-bold text-lg leading-tight line-clamp-2 text-tzeentch-cyan group-hover:text-tzeentch-cyan transition-colors duration-500 ${marginClass}`}>{book.title}</h3>;
      case 'author':
        return <p key={field} className={`text-sm text-tzeentch-text-muted font-medium ${marginClass}`}>{book.author}</p>;
      case 'narrator':
        return <p key={field} className={`text-xs text-tzeentch-text-faint italic ${marginClass}`}>Narrator: {book.narrator || '—'}</p>;
      case 'series':
        return (
          <p key={field} className={`text-xs text-tzeentch-cyan/80 font-medium ${marginClass}`}>
            Series: {book.series || '—'}
            {book.series && book.series_number && ` #${book.series_number}`}
          </p>
        );
      case 'rating':
        return (
          <div key={field} className={`flex items-center justify-between ${marginClass}`}>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star 
                  key={star} 
                  size={14} 
                  className={star <= (book.rating || 0) ? 'fill-tzeentch-gold text-tzeentch-gold drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]' : 'text-tzeentch-text-faint/50'} 
                />
              ))}
            </div>
          </div>
        );
      case 'format':
        return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>Format: {book.format}</p>;
      case 'status':
        return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>Status: {book.status}</p>;
      case 'started_reading':
        return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>Started: {book.started_reading || '—'}</p>;
      case 'finished_reading':
        return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>Finished: {book.finished_reading || '—'}</p>;
      case 'page_count':
        return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>Pages: {book.page_count || '—'}</p>;
      case 'published_date':
        return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>Published: {book.published_date || '—'}</p>;
      case 'publisher':
        return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>Publisher: {book.publisher || '—'}</p>;
      case 'tags':
        if (!book.tags) return <p key={field} className={`text-xs text-tzeentch-text-faint ${marginClass}`}>—</p>;
        const uniqueTags = Array.from(new Set<string>(book.tags.split(',').map(t => t.trim()).filter(Boolean)));
        return (
          <div key={field} className={`flex flex-wrap gap-1 ${marginClass}`}>
            {uniqueTags.map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-tzeentch-cyan/10 text-tzeentch-cyan text-[9px] font-bold rounded border border-tzeentch-cyan/20 truncate max-w-full" title={tag}>
                {tag.toUpperCase()}
              </span>
            ))}
          </div>
        );
      case 'isbn':
        return <p key={field} className={`text-xs text-tzeentch-text-faint font-mono ${marginClass}`}>ISBN: {book.isbn || book.asin || '—'}</p>;
      case 'description':
        return <p key={field} className={`text-xs text-tzeentch-text-faint line-clamp-3 ${marginClass}`}>{book.description || '—'}</p>;
      case 'metadata_source':
        return <p key={field} className={`text-xs text-tzeentch-text-faint truncate ${marginClass}`}>Source: {book.metadata_source || '—'}</p>;
      case 'notes':
        return <p key={field} className={`text-xs text-tzeentch-text-faint line-clamp-2 ${marginClass}`}>Notes: {book.notes || '—'}</p>;
      default:
        return null;
    }
  };

  return (
    <motion.div 
      layout
      onClick={() => {
        if (isMultiSelectMode && onToggleSelection) {
          onToggleSelection();
        } else {
          onClick();
        }
      }}
      className={`group relative bg-tzeentch-card rounded-xl overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.2)] transition-all duration-500 border cursor-pointer flex flex-col h-full ${isSelected ? 'border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.5)]' : 'border-tzeentch-cyan/10 hover:border-tzeentch-cyan/30'}`}
    >
      {/* Multi-select overlay */}
      {isMultiSelectMode && (
        <div className="absolute top-3 right-3 z-20">
          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-tzeentch-cyan border-tzeentch-cyan text-tzeentch-bg' : 'border-tzeentch-cyan/40 bg-tzeentch-bg/50'}`}>
            {isSelected && <CheckCircle size={14} />}
          </div>
        </div>
      )}

      {/* Cover Image */}
      <div className="aspect-[4/5] relative overflow-hidden bg-tzeentch-warp/40 shrink-0">
        {book.cover_url ? (
          <img 
            src={book.cover_url} 
            alt={book.title}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 group-hover:rotate-1"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-tzeentch-cyan/10">
            <BookIcon size={48} />
          </div>
        )}
        
        {/* Format Badge */}
        <div className="absolute top-3 left-3 px-2 py-1 rounded bg-tzeentch-bg/80 backdrop-blur-md text-tzeentch-cyan text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 border border-tzeentch-cyan/20">
          {book.format === 'Audiobook' ? <Headphones size={10} /> : <BookIcon size={10} />}
          {book.format}
        </div>

        {/* Overlay Actions */}
        <div className="absolute inset-0 bg-tzeentch-bg/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsMenuOpen(!isMenuOpen);
            }}
            className="w-12 h-12 rounded-full bg-tzeentch-cyan text-tzeentch-bg flex items-center justify-center hover:scale-110 transition-transform shadow-[0_0_15px_rgba(34,211,238,0.5)]"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-4 border-t border-tzeentch-cyan/5 flex flex-col flex-1">
        {fields.map((field, idx) => renderField(field, idx === fields.length - 1))}
      </div>

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
            className="absolute bottom-4 right-4 z-20 bg-tzeentch-bg rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-tzeentch-cyan/30 p-2 min-w-[160px] animate-in fade-in zoom-in duration-200 backdrop-blur-xl"
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
            className="absolute inset-0 z-30 bg-tzeentch-bg/95 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 size={32} className="text-red-500 mb-2" />
            <p className="text-xs font-bold text-tzeentch-cyan uppercase tracking-widest mb-4">Banish this tome?</p>
            <div className="flex gap-2 w-full">
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
    </motion.div>
  );
});

export default BookCard;
