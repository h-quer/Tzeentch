import React, { useState } from 'react';
import { X, Save, Edit3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AVAILABLE_FIELDS } from './SettingsModal';

interface BulkEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: number[];
  onSuccess: () => void;
  viewPreferences?: Record<string, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
}

export default function BulkEditModal({ isOpen, onClose, selectedIds, onSuccess, viewPreferences }: BulkEditModalProps) {
  const [selectedField, setSelectedField] = useState<string>('');
  const [newValue, setNewValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Filter out fields that shouldn't be bulk edited
  const editableFields = AVAILABLE_FIELDS.filter(f => 
    !['title', 'isbn', 'description', 'page_count', 'published_date'].includes(f.id)
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedField || selectedIds.length === 0) return;

    setIsSaving(true);
    try {
      const updates: Record<string, any> = { [selectedField]: newValue };
      
      // Special handling for rating to ensure it's a number
      if (selectedField === 'rating') {
        updates[selectedField] = newValue ? Number(newValue) : null;
      }

      const response = await fetch('/api/books', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, updates }),
      });

      if (response.ok) {
        onSuccess();
        onClose();
      }
    } catch (error) {
      console.error('Failed to bulk update books:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const renderInput = () => {
    if (!selectedField) return null;

    if (selectedField === 'status') {
      return (
        <select
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="w-full bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-lg p-3 text-tzeentch-cyan focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all"
        >
          <option value="" className="bg-tzeentch-bg text-tzeentch-text">Select Status</option>
          {viewPreferences?.['Reading'] !== 'disabled' && <option value="Reading" className="bg-tzeentch-bg text-tzeentch-text">Reading</option>}
          {viewPreferences?.['Read'] !== 'disabled' && <option value="Read" className="bg-tzeentch-bg text-tzeentch-text">Read</option>}
          {viewPreferences?.['Backlog'] !== 'disabled' && <option value="Backlog" className="bg-tzeentch-bg text-tzeentch-text">Backlog</option>}
          {viewPreferences?.['Wishlist'] !== 'disabled' && <option value="Wishlist" className="bg-tzeentch-bg text-tzeentch-text">Wishlist</option>}
          {viewPreferences?.['Dropped'] !== 'disabled' && <option value="Dropped" className="bg-tzeentch-bg text-tzeentch-text">Dropped</option>}
        </select>
      );
    }

    if (selectedField === 'format') {
      return (
        <select
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="w-full bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-lg p-3 text-tzeentch-cyan focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all"
        >
          <option value="" className="bg-tzeentch-bg text-tzeentch-text">Select Format</option>
          <option value="Book" className="bg-tzeentch-bg text-tzeentch-text">Book</option>
          <option value="Audiobook" className="bg-tzeentch-bg text-tzeentch-text">Audiobook</option>
        </select>
      );
    }

    if (selectedField === 'rating') {
      return (
        <select
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="w-full bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-lg p-3 text-tzeentch-cyan focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all"
        >
          <option value="" className="bg-tzeentch-bg text-tzeentch-text">Select Rating</option>
          {[0, 1, 2, 3, 4, 5].map(r => (
            <option key={r} value={r.toString()} className="bg-tzeentch-bg text-tzeentch-text">{r} Stars</option>
          ))}
        </select>
      );
    }

    if (selectedField === 'started_reading' || selectedField === 'finished_reading') {
      return (
        <input
          type="date"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="w-full bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-lg p-3 text-tzeentch-text focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all"
        />
      );
    }

    return (
      <input
        type="text"
        value={newValue}
        onChange={(e) => setNewValue(e.target.value)}
        placeholder={`Enter new ${editableFields.find(f => f.id === selectedField)?.label.toLowerCase()}...`}
        className="w-full bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-lg p-3 text-tzeentch-text placeholder-tzeentch-cyan/30 focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all"
      />
    );
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
            className="relative w-full max-w-md bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-2xl shadow-[0_0_50px_rgba(34,211,238,0.15)] overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-tzeentch-cyan/20 bg-tzeentch-card/30 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-tzeentch-cyan/10 rounded-full flex items-center justify-center text-tzeentch-cyan border border-tzeentch-cyan/20">
                  <Edit3 size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-tzeentch-cyan tracking-tight">Bulk Edit</h2>
                  <p className="text-xs text-tzeentch-text-muted uppercase tracking-widest">{selectedIds.length} Tomes Selected</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-tzeentch-cyan/40 hover:text-tzeentch-cyan hover:bg-tzeentch-cyan/10 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-tzeentch-cyan/60 uppercase tracking-widest">Field to Update</label>
                <select
                  value={selectedField}
                  onChange={(e) => {
                    setSelectedField(e.target.value);
                    setNewValue(''); // Reset value when field changes
                  }}
                  className="w-full bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-lg p-3 text-tzeentch-cyan focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50 transition-all font-bold"
                  required
                >
                  <option value="" className="bg-tzeentch-bg text-tzeentch-text">Select a field...</option>
                  {editableFields.map(field => (
                    <option key={field.id} value={field.id} className="bg-tzeentch-bg text-tzeentch-text">{field.label}</option>
                  ))}
                </select>
              </div>

              {selectedField && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-tzeentch-cyan/60 uppercase tracking-widest">New Value</label>
                  {renderInput()}
                  <p className="text-xs text-tzeentch-magenta/80 mt-2">
                    Warning: This will overwrite the {editableFields.find(f => f.id === selectedField)?.label} for all {selectedIds.length} selected books.
                  </p>
                </div>
              )}

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-lg border border-tzeentch-cyan/20 text-tzeentch-text/90 hover:bg-tzeentch-cyan/10 transition-all text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !selectedField}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-tzeentch-cyan text-tzeentch-bg hover:bg-tzeentch-cyan/80 transition-all text-sm font-bold shadow-[0_0_20px_rgba(34,211,238,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={16} />
                  <span>{isSaving ? 'Applying...' : 'Apply Bulk Edit'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
