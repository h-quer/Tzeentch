import React, { useState, useEffect, useRef } from 'react';
import { X, Star, BookOpen, CheckCircle, Library, Bookmark, Trash2, Calendar, Hash, Building, Tag, Headphones, Book as BookIcon, Edit2, Save, Plus, RefreshCw, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, BookStatus, BookFormat } from '../types';
import RefreshMetadataModal from './RefreshMetadataModal';
import ManualRefreshModal from './ManualRefreshModal';
import ConfirmModal from './ConfirmModal';

interface BookDetailsModalProps {
  book: Book | null;
  onClose: () => void;
  onUpdate: (updatedBook?: Book) => void;
  viewPreferences?: Record<string, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
}

export default function BookDetailsModal({ book, onClose, onUpdate, viewPreferences }: BookDetailsModalProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRefreshModalOpen, setIsRefreshModalOpen] = useState(false);
  const [editedBook, setEditedBook] = useState<Book | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState<{isOpen: boolean, newStatus: BookStatus | null, message: string}>({isOpen: false, newStatus: null, message: ''});
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing) {
      fetch('/api/tags')
        .then(res => res.json())
        .then(setAvailableTags)
        .catch(err => console.error('Failed to fetch tags:', err));
    }
  }, [isEditing]);

  useEffect(() => {
    if (book) {
      const initialTags = book.tags ? book.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      setSelectedTags(initialTags);
    }
  }, [book, isEditing]);

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

  useEffect(() => {
    if (book) {
      setEditedBook({ ...book });
      setIsEditing(false);
    }
  }, [book]);

  if (!book || !editedBook) return null;

  const handleClose = () => {
    setIsEditing(false);
    setIsConfirmingDelete(false);
    onClose();
  };

  const handleSave = async () => {
    setIsUpdating(true);
    try {
      const bookToSave = {
        ...editedBook,
        tags: selectedTags.join(', ')
      };
      const response = await fetch(`/api/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookToSave),
      });
      const data = await response.json();
      if (data.book) {
        setEditedBook(data.book);
        onUpdate(data.book);
      } else {
        setEditedBook(bookToSave as Book);
        onUpdate(bookToSave as Book);
      }
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update book:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStatusChangeClick = (newStatus: BookStatus) => {
    const currentStatus = editedBook.status;
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
    setIsUpdating(true);
    try {
      const updates: any = { status: newStatus };
      const currentStatus = editedBook.status;
      const today = new Date().toISOString().split('T')[0];
      
      if (newStatus === 'Reading') {
        if (currentStatus !== 'Dropped') {
          updates.finished_reading = '';
          if (currentStatus === 'Backlog' || currentStatus === 'Wishlist') {
            updates.started_reading = today;
          } else if (!editedBook.started_reading) {
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
          if (!editedBook.finished_reading) updates.finished_reading = today;
        } else {
          if (!editedBook.finished_reading) updates.finished_reading = today;
          if (!editedBook.started_reading) updates.started_reading = today;
        }
      } else if (newStatus === 'Backlog' || newStatus === 'Wishlist') {
        if (currentStatus !== 'Dropped') {
          updates.started_reading = '';
          updates.finished_reading = '';
        }
      }

      const response = await fetch(`/api/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await response.json();
      
      if (data.book) {
        setEditedBook(data.book);
        onUpdate(data.book);
      } else {
        setEditedBook(prev => prev ? { ...prev, ...updates } : null);
        onUpdate({ ...editedBook, ...updates } as Book);
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setIsUpdating(false);
      setStatusConfirm({isOpen: false, newStatus: null, message: ''});
    }
  };

  const removeBook = async () => {
    try {
      await fetch(`/api/books/${book.id}`, { method: 'DELETE' });
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Failed to delete book:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditedBook(prev => {
      if (!prev) return null;
      const next = { ...prev, [name]: value };
      
      // Automatic status transitions based on date entry
      if (name === 'finished_reading' && value) {
        next.status = 'Read';
      } else if (name === 'started_reading' && value && (prev.status === 'Backlog' || prev.status === 'Wishlist')) {
        next.status = 'Reading';
      }

      // Automatic format transition based on metadata source
      if (name === 'metadata_source' && value.toLowerCase().includes('audible')) {
        next.format = 'Audiobook';
      }

      // Logic for manual status selection
      if (name === 'status') {
        const today = new Date().toISOString().split('T')[0];
        if (value === 'Reading') {
          if (prev.status !== 'Dropped') {
            next.finished_reading = '';
            if (prev.status === 'Backlog' || prev.status === 'Wishlist') {
              next.started_reading = today;
            } else if (!next.started_reading) {
              next.started_reading = today;
            }
          }
        } else if (value === 'Read') {
          if (prev.status === 'Backlog' || prev.status === 'Wishlist') {
            next.started_reading = today;
            next.finished_reading = today;
          } else if (prev.status === 'Reading') {
            next.finished_reading = today;
          } else if (prev.status === 'Dropped') {
            if (!next.finished_reading) next.finished_reading = today;
          } else {
            if (!next.finished_reading) next.finished_reading = today;
            if (!next.started_reading) next.started_reading = today;
          }
        } else if (value === 'Backlog' || value === 'Wishlist') {
          if (prev.status !== 'Dropped') {
            next.started_reading = '';
            next.finished_reading = '';
          }
        }
      }
      
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
        className="absolute inset-0 bg-tzeentch-overlay backdrop-blur-md"
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
        className="relative bg-tzeentch-bg w-full max-w-5xl rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.9)] overflow-y-auto flex flex-col md:flex-row max-h-[90vh] border border-tzeentch-cyan/30 no-scrollbar"
      >
        {/* Left: Cover & Actions */}
        <div className="w-full md:w-1/3 bg-tzeentch-card/50 p-6 sm:p-8 flex flex-col items-center border-b md:border-b-0 md:border-r border-tzeentch-cyan/10">
          <div className="w-48 sm:w-full aspect-[2/3] rounded-2xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] border border-tzeentch-cyan/20 mb-6 sm:mb-8">
            {book.cover_url ? (
              <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-tzeentch-cyan/10">
                <BookIcon size={80} />
              </div>
            )}
          </div>

          {!isEditing && (
            <div className="w-full space-y-3">
              <p className="text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-[0.2em] mb-2 sm:mb-4 text-center">Alter Destiny</p>
              <div className="grid grid-cols-2 md:grid-cols-1 gap-2">
                {viewPreferences?.['Reading'] !== 'disabled' && (
                  <button 
                    disabled={isUpdating}
                    onClick={() => handleStatusChangeClick('Reading')}
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-[10px] sm:text-sm font-bold transition-all border ${editedBook.status === 'Reading' ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'bg-tzeentch-bg text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40'}`}
                  >
                    <BookOpen size={16} className="sm:w-[18px] sm:h-[18px]" /> READING
                  </button>
                )}
                {viewPreferences?.['Read'] !== 'disabled' && (
                  <button 
                    disabled={isUpdating}
                    onClick={() => handleStatusChangeClick('Read')}
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-[10px] sm:text-sm font-bold transition-all border ${editedBook.status === 'Read' ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'bg-tzeentch-bg text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40'}`}
                  >
                    <CheckCircle size={16} className="sm:w-[18px] sm:h-[18px]" /> READ
                  </button>
                )}
                {viewPreferences?.['Backlog'] !== 'disabled' && (
                  <button 
                    disabled={isUpdating}
                    onClick={() => handleStatusChangeClick('Backlog')}
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-[10px] sm:text-sm font-bold transition-all border ${editedBook.status === 'Backlog' ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'bg-tzeentch-bg text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40'}`}
                  >
                    <Library size={16} className="sm:w-[18px] sm:h-[18px]" /> BACKLOG
                  </button>
                )}
                {viewPreferences?.['Wishlist'] !== 'disabled' && (
                  <button 
                    disabled={isUpdating}
                    onClick={() => handleStatusChangeClick('Wishlist')}
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-[10px] sm:text-sm font-bold transition-all border ${editedBook.status === 'Wishlist' ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'bg-tzeentch-bg text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40'}`}
                  >
                    <Bookmark size={16} className="sm:w-[18px] sm:h-[18px]" /> WISHLIST
                  </button>
                )}
                {viewPreferences?.['Dropped'] !== 'disabled' && (
                  <button 
                    disabled={isUpdating}
                    onClick={() => handleStatusChangeClick('Dropped')}
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-[10px] sm:text-sm font-bold transition-all border ${editedBook.status === 'Dropped' ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.4)]' : 'bg-tzeentch-bg text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40'}`}
                  >
                    <XCircle size={16} className="sm:w-[18px] sm:h-[18px]" /> DROPPED
                  </button>
                )}
                <button 
                  disabled={isUpdating}
                  onClick={() => setIsRefreshModalOpen(true)}
                  className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-[10px] sm:text-sm font-bold transition-all border bg-tzeentch-bg text-tzeentch-cyan border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40 col-span-2 md:col-span-1"
                >
                  <RefreshCw size={16} className="sm:w-[18px] sm:h-[18px]" /> REFRESH METADATA
                </button>
              </div>
              
              <button 
                onClick={() => setIsConfirmingDelete(true)}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-400 hover:bg-red-900/20 transition-all mt-4 sm:mt-6"
              >
                <Trash2 size={18} /> BANISH TOME
              </button>
            </div>
          )}
        </div>

        {/* Delete Confirmation Overlay */}
        <AnimatePresence>
          {isConfirmingDelete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[60] bg-tzeentch-bg/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center"
            >
              <div className="w-20 h-20 bg-red-900/20 rounded-full flex items-center justify-center mb-6 border border-red-500/30">
                <Trash2 size={40} className="text-red-500" />
              </div>
              <h3 className="text-2xl font-bold text-tzeentch-cyan font-display tracking-tighter mb-2">BANISH THIS TOME?</h3>
              <p className="text-tzeentch-text-muted font-medium mb-8 max-w-xs">
                Are you certain you wish to erase "{editedBook.title}" from your archives forever?
              </p>
              <div className="flex gap-4 w-full max-w-sm">
                <button 
                  onClick={() => setIsConfirmingDelete(false)}
                  className="flex-1 py-4 rounded-2xl bg-tzeentch-card text-tzeentch-text/90 font-bold hover:bg-tzeentch-card/80 transition-all border border-tzeentch-cyan/10"
                >
                  ABORT
                </button>
                <button 
                  onClick={removeBook}
                  className="flex-1 py-4 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-700 transition-all shadow-[0_0_30px_rgba(220,38,38,0.4)]"
                >
                  BANISH
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Right: Metadata */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-6 sm:p-8 pb-4 flex justify-between items-start">
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="space-y-4">
                  <input
                    name="title"
                    value={editedBook.title}
                    onChange={handleInputChange}
                    className="w-full text-2xl sm:text-4xl font-bold text-tzeentch-cyan bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-xl px-4 py-2 font-display tracking-tighter"
                    placeholder="Book Title"
                  />
                  <input
                    name="author"
                    value={editedBook.author}
                    onChange={handleInputChange}
                    className="w-full text-lg sm:text-xl text-tzeentch-text/90 bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-xl px-4 py-2 italic"
                    placeholder="Author"
                  />
                </div>
              ) : (
                <>
                  <h2 className="text-2xl sm:text-4xl font-bold text-tzeentch-cyan font-display tracking-tighter mb-2 leading-tight">{editedBook.title}</h2>
                  <p className="text-lg sm:text-xl text-tzeentch-text-muted italic">{editedBook.author}</p>
                </>
              )}
            </div>
            <div className="flex gap-2 ml-4">
              {isEditing ? (
                <button 
                  onClick={handleSave}
                  disabled={isUpdating}
                  className="p-2.5 sm:p-3 bg-tzeentch-cyan text-tzeentch-bg rounded-xl hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] transition-all flex items-center gap-2 font-bold text-xs sm:text-base"
                >
                  <Save size={18} className="sm:w-[20px] sm:h-[20px]" /> <span className="hidden xs:inline">SAVE</span>
                </button>
              ) : (
                <button 
                  onClick={() => setIsEditing(true)}
                  className="p-2.5 sm:p-3 bg-tzeentch-bg text-tzeentch-cyan border border-tzeentch-cyan/30 rounded-xl hover:border-tzeentch-cyan transition-all flex items-center gap-2 font-bold text-xs sm:text-base"
                >
                  <Edit2 size={18} className="sm:w-[20px] sm:h-[20px]" /> <span className="hidden xs:inline">EDIT</span>
                </button>
              )}
              <button onClick={handleClose} className="p-1.5 sm:p-2 hover:bg-tzeentch-cyan/10 rounded-full transition-colors flex-shrink-0">
                <X size={24} className="sm:w-[28px] sm:h-[28px] text-tzeentch-cyan/40" />
              </button>
            </div>
          </div>

          <div className="flex-1 p-6 sm:p-8 pt-4 space-y-6 sm:space-y-8">
            {/* Rating, Format & Status */}
            <div className="flex flex-wrap gap-8">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-widest">Arcane Rating</p>
                {isEditing ? (
                  <select
                    name="rating"
                    value={editedBook.rating || 0}
                    onChange={handleInputChange}
                    className="bg-tzeentch-bg text-tzeentch-gold border border-tzeentch-cyan/30 rounded-lg px-3 py-1 font-bold"
                  >
                    {[0, 1, 2, 3, 4, 5].map(r => (
                      <option key={r} value={r}>{r} Stars</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star 
                        key={star} 
                        size={20} 
                        className={star <= (editedBook.rating || 0) ? 'fill-tzeentch-gold text-tzeentch-gold drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]' : 'text-tzeentch-text-faint/30'} 
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-widest">Manifestation</p>
                {isEditing ? (
                  <select
                    name="format"
                    value={editedBook.format}
                    onChange={handleInputChange}
                    className="bg-tzeentch-bg text-tzeentch-cyan border border-tzeentch-cyan/30 rounded-lg px-3 py-1 font-bold"
                  >
                    <option value="Book">Book</option>
                    <option value="Audiobook">Audiobook</option>
                  </select>
                ) : (
                  <div className="flex items-center gap-2 text-tzeentch-cyan font-bold">
                    {editedBook.format === 'Audiobook' ? <Headphones size={18} /> : <BookIcon size={18} />}
                    <span>{editedBook.format.toUpperCase()}</span>
                  </div>
                )}
              </div>
              {isEditing && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-widest">Destined Shelf</p>
                  <select
                    name="status"
                    value={editedBook.status}
                    onChange={handleInputChange}
                    className="bg-tzeentch-bg text-tzeentch-cyan border border-tzeentch-cyan/30 rounded-lg px-3 py-1 font-bold"
                  >
                    {viewPreferences?.['Reading'] !== 'disabled' && <option value="Reading">Reading</option>}
                    {viewPreferences?.['Read'] !== 'disabled' && <option value="Read">Read</option>}
                    {viewPreferences?.['Backlog'] !== 'disabled' && <option value="Backlog">Backlog</option>}
                    {viewPreferences?.['Wishlist'] !== 'disabled' && <option value="Wishlist">Wishlist</option>}
                    {viewPreferences?.['Dropped'] !== 'disabled' && <option value="Dropped">Dropped</option>}
                  </select>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-widest">Inscribed Knowledge (Summary)</p>
              {isEditing ? (
                <textarea
                  name="description"
                  value={editedBook.description || ''}
                  onChange={handleInputChange}
                  rows={6}
                  className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-2xl px-4 py-3 font-sans text-sm"
                  placeholder="Book summary..."
                />
              ) : (
                editedBook.description && (
                  <p className="text-tzeentch-text/90 leading-relaxed font-sans text-sm bg-tzeentch-card/30 p-4 rounded-2xl border border-tzeentch-cyan/5 whitespace-pre-wrap">
                    {editedBook.description}
                  </p>
                )
              )}
            </div>

            {/* Grid Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Headphones size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Narrator</span>
                </div>
                {isEditing ? (
                  <input
                    name="narrator"
                    value={editedBook.narrator || ''}
                    onChange={handleInputChange}
                    className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                    placeholder="Narrator name"
                  />
                ) : (
                  <p className="text-sm font-bold text-tzeentch-text/90">{editedBook.narrator || 'N/A'}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Library size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Series</span>
                </div>
                {isEditing ? (
                  <div className="flex gap-2">
                    <input
                      name="series"
                      value={editedBook.series || ''}
                      onChange={handleInputChange}
                      className="flex-[3] min-w-0 bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                      placeholder="Series name"
                    />
                    <input
                      name="series_number"
                      value={editedBook.series_number || ''}
                      onChange={handleInputChange}
                      className="flex-1 min-w-0 bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                      placeholder="#"
                    />
                  </div>
                ) : (
                  <p className="text-sm font-bold text-tzeentch-text/90">
                    {editedBook.series || 'N/A'}
                    {editedBook.series && editedBook.series_number && ` #${editedBook.series_number}`}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Calendar size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Release Date</span>
                </div>
                {isEditing ? (
                  <input
                    name="published_date"
                    value={editedBook.published_date || ''}
                    onChange={handleInputChange}
                    className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                    placeholder="YYYY-MM-DD"
                  />
                ) : (
                  <p className="text-sm font-bold text-tzeentch-text/90">{editedBook.published_date || 'N/A'}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Bookmark size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Metadata Source</span>
                </div>
                {isEditing ? (
                  <input
                    name="metadata_source"
                    value={editedBook.metadata_source || ''}
                    onChange={handleInputChange}
                    className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                    placeholder="Source link"
                  />
                ) : (
                  editedBook.metadata_source ? (
                    <a href={editedBook.metadata_source} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-tzeentch-cyan hover:underline truncate block">
                      {editedBook.metadata_source}
                    </a>
                  ) : <p className="text-sm font-bold text-tzeentch-text/90">N/A</p>
                )}
              </div>

              <div className="space-y-1.5 relative md:col-span-2" ref={dropdownRef}>
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Tag size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Custom Tags</span>
                </div>
                {isEditing ? (
                  <div className="space-y-3 bg-tzeentch-card/20 p-4 rounded-xl border border-tzeentch-cyan/10">
                    <div className="flex flex-wrap gap-2">
                      {selectedTags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-tzeentch-cyan/10 text-tzeentch-cyan text-[10px] font-bold rounded-md border border-tzeentch-cyan/20">
                          {tag.toUpperCase()}
                          <button onClick={() => removeTag(tag)} className="hover:text-tzeentch-magenta transition-colors">
                            <X size={10} />
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
                        placeholder="Add tags..."
                        className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                      />
                      {tagInput && (
                        <button 
                          onClick={() => handleAddTag(tagInput)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-tzeentch-cyan text-tzeentch-bg rounded hover:bg-tzeentch-cyan/80 transition-colors"
                        >
                          <Plus size={14} />
                        </button>
                      )}
                    </div>

                    <AnimatePresence>
                      {isTagDropdownOpen && (availableTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t)).length > 0) && (
                        <motion.div 
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="absolute z-50 w-full mt-1 bg-tzeentch-card border border-tzeentch-cyan/30 rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden max-h-48 overflow-y-auto backdrop-blur-xl"
                        >
                          {availableTags
                            .filter(t => t.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t))
                            .map(tag => (
                              <button
                                key={tag}
                                onClick={() => handleAddTag(tag)}
                                className="w-full text-left px-4 py-2.5 text-xs text-tzeentch-text/90 hover:bg-tzeentch-cyan/10 hover:text-tzeentch-cyan transition-colors border-b border-tzeentch-cyan/5 last:border-0"
                              >
                                {tag}
                              </button>
                            ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {editedBook.tags ? Array.from(new Set<string>(editedBook.tags.split(',').map(t => t.trim()).filter(Boolean))).map(tag => (
                      <span key={tag} className="px-2 py-1 bg-tzeentch-cyan/10 text-tzeentch-cyan text-[10px] font-bold rounded-md border border-tzeentch-cyan/20">
                        {tag.toUpperCase()}
                      </span>
                    )) : <p className="text-sm font-bold text-tzeentch-text/90">N/A</p>}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 text-tzeentch-magenta/40">
                    <BookOpen size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Started Reading</span>
                  </div>
                  {isEditing && (
                    <button 
                      type="button" 
                      onClick={() => handleInputChange({ target: { name: 'started_reading', value: new Date().toISOString().split('T')[0] } } as any)}
                      className="text-[10px] font-bold text-tzeentch-magenta hover:text-tzeentch-cyan transition-colors uppercase tracking-widest"
                    >
                      Today
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <input
                    name="started_reading"
                    type="text"
                    value={editedBook.started_reading || ''}
                    onChange={handleInputChange}
                    placeholder="YYYY-MM-DD"
                    className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                  />
                ) : (
                  <p className="text-sm font-bold text-tzeentch-text/90">{editedBook.started_reading || 'N/A'}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                    <CheckCircle size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Finished Reading</span>
                  </div>
                  {isEditing && (
                    <button 
                      type="button" 
                      onClick={() => handleInputChange({ target: { name: 'finished_reading', value: new Date().toISOString().split('T')[0] } } as any)}
                      className="text-[10px] font-bold text-tzeentch-magenta hover:text-tzeentch-cyan transition-colors uppercase tracking-widest"
                    >
                      Today
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <input
                    name="finished_reading"
                    type="text"
                    value={editedBook.finished_reading || ''}
                    onChange={handleInputChange}
                    placeholder="YYYY-MM-DD"
                    className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                  />
                ) : (
                  <p className="text-sm font-bold text-tzeentch-text/90">{editedBook.finished_reading || 'N/A'}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Hash size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">ISBN / ASIN</span>
                </div>
                {isEditing ? (
                  <div className="flex gap-2">
                    <input
                      name="isbn"
                      value={editedBook.isbn || ''}
                      onChange={handleInputChange}
                      className="flex-1 min-w-0 bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm font-mono focus:border-tzeentch-cyan outline-none transition-colors"
                      placeholder="ISBN"
                    />
                    <input
                      name="asin"
                      value={editedBook.asin || ''}
                      onChange={handleInputChange}
                      className="flex-1 min-w-0 bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm font-mono focus:border-tzeentch-cyan outline-none transition-colors"
                      placeholder="ASIN"
                    />
                  </div>
                ) : (
                  <p className="text-sm font-mono text-tzeentch-text/90">{editedBook.isbn || editedBook.asin || 'N/A'}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Hash size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Page Count</span>
                </div>
                {isEditing ? (
                  <input
                    name="page_count"
                    type="number"
                    value={editedBook.page_count || ''}
                    onChange={handleInputChange}
                    className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                  />
                ) : (
                  <p className="text-sm font-bold text-tzeentch-text/90">{editedBook.page_count || 'N/A'}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-tzeentch-cyan/40">
                  <Building size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Publisher</span>
                </div>
                {isEditing ? (
                  <input
                    name="publisher"
                    value={editedBook.publisher || ''}
                    onChange={handleInputChange}
                    className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-lg px-3 py-2 text-sm focus:border-tzeentch-cyan outline-none transition-colors"
                  />
                ) : (
                  <p className="text-sm font-bold text-tzeentch-text/90">{editedBook.publisher || 'N/A'}</p>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-tzeentch-cyan/40 uppercase tracking-widest">Arcane Notes</p>
              {isEditing ? (
                <textarea
                  name="notes"
                  value={editedBook.notes || ''}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full bg-tzeentch-bg text-tzeentch-text/90 border border-tzeentch-cyan/30 rounded-2xl px-4 py-3 font-sans text-sm italic"
                  placeholder="Your notes..."
                />
              ) : (
                editedBook.notes && (
                  <p className="text-tzeentch-text-muted italic font-sans text-sm border-l-2 border-tzeentch-magenta/30 pl-4 py-1">
                    "{editedBook.notes}"
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      </motion.div>
      {isRefreshModalOpen && (
        <ManualRefreshModal
          isOpen={isRefreshModalOpen}
          onClose={() => setIsRefreshModalOpen(false)}
          book={book}
          onSuccess={async (updatedBook) => {
            setEditedBook(updatedBook);
            onUpdate(updatedBook);
            setIsRefreshModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
