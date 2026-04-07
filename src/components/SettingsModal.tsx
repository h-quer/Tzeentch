import React, { useState, useRef } from 'react';
import { X, ArrowUp, ArrowDown, Plus, Trash2, Monitor, Sun, Moon, LayoutGrid, List, Upload, FileText, Check, Loader2, AlertCircle, EyeOff, Combine } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UIConfig } from '../types';

interface SettingsModalProps {
  config: UIConfig;
  onSave: (config: UIConfig) => void;
  onClose: () => void;
  onImportSuccess: () => void;
}

export const AVAILABLE_FIELDS = [
  { id: 'title', label: 'Title & Cover' },
  { id: 'author', label: 'Author' },
  { id: 'narrator', label: 'Narrator' },
  { id: 'series', label: 'Series' },
  { id: 'rating', label: 'Rating' },
  { id: 'format', label: 'Format' },
  { id: 'status', label: 'Status' },
  { id: 'started_reading', label: 'Started Reading' },
  { id: 'finished_reading', label: 'Finished Reading' },
  { id: 'page_count', label: 'Page Count' },
  { id: 'published_date', label: 'Published Date' },
  { id: 'publisher', label: 'Publisher' },
  { id: 'tags', label: 'Tags' },
  { id: 'isbn', label: 'ISBN/ASIN' },
  { id: 'description', label: 'Description' },
  { id: 'metadata_source', label: 'Metadata Source' },
  { id: 'notes', label: 'Notes' }
];

export default function SettingsModal({ config, onSave, onClose, onImportSuccess }: SettingsModalProps) {
  const [listColumns, setListColumns] = useState<string[]>((config.listColumns || []).filter(c => c !== 'series_number'));
  const [cardFields, setCardFields] = useState<string[]>((config.cardFields || []).filter(f => f !== 'series_number'));
  const [sortFields, setSortFields] = useState<{id: string, direction: 'asc' | 'desc'}[]>((config.sortFields || [
    { id: 'finished_reading', direction: 'desc' },
    { id: 'started_reading', direction: 'desc' },
    { id: 'author', direction: 'asc' }
  ]).filter(f => f.id !== 'series_number'));
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(config.theme || 'system');
  const [viewPreferences, setViewPreferences] = useState<Record<string, 'cards' | 'list' | 'disabled'>>(config.viewPreferences || {
    Reading: 'cards',
    Read: 'list',
    Backlog: 'list',
    Wishlist: 'cards',
    Dropped: 'cards'
  });
  const [activeTab, setActiveTab] = useState<'card' | 'list' | 'sort' | 'theme' | 'import'>('card');

  // Import State
  const [file, setFile] = useState<File | null>(null);
  const [importFormat, setImportFormat] = useState<'Book' | 'Audiobook' | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const moveItem = (list: string[], setList: (l: string[]) => void, index: number, direction: 'up' | 'down') => {
    const newList = [...list];
    if (direction === 'up' && index > 0) {
      [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
    } else if (direction === 'down' && index < newList.length - 1) {
      [newList[index + 1], newList[index]] = [newList[index], newList[index + 1]];
    }
    setList(newList);
  };

  const removeItem = (list: string[], setList: (l: string[]) => void, index: number) => {
    const newList = [...list];
    newList.splice(index, 1);
    setList(newList);
  };

  const addItem = (list: string[], setList: (l: string[]) => void, id: string) => {
    if (!list.includes(id)) {
      setList([...list, id]);
    }
  };

  const moveSortItem = (index: number, direction: 'up' | 'down') => {
    const newList = [...sortFields];
    if (direction === 'up' && index > 0) {
      [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
    } else if (direction === 'down' && index < newList.length - 1) {
      [newList[index + 1], newList[index]] = [newList[index], newList[index + 1]];
    }
    setSortFields(newList);
  };

  const removeSortItem = (index: number) => {
    const newList = [...sortFields];
    newList.splice(index, 1);
    setSortFields(newList);
  };

  const addSortItem = (id: string) => {
    if (!sortFields.find(f => f.id === id)) {
      setSortFields([...sortFields, { id, direction: 'asc' }]);
    }
  };

  const toggleSortDirection = (index: number) => {
    const newList = [...sortFields];
    newList[index].direction = newList[index].direction === 'asc' ? 'desc' : 'asc';
    setSortFields(newList);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setImportError(null);
    } else {
      setImportError('Please select a valid CSV file.');
      setFile(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setImportLoading(true);
    setImportError(null);
    
    const formData = new FormData();
    formData.append('file', file);
    
    if (importFormat) {
      formData.append('format', importFormat);
    }

    try {
      const response = await fetch('/api/import/goodreads', {
        method: 'POST',
        body: formData,
      });
      
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        throw new Error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
      }

      if (data.success) {
        setImportSuccessCount(data.count);
        onImportSuccess();
      } else {
        setImportError(data.error || 'Import failed');
      }
    } catch (error) {
      console.error('Import error:', error);
      setImportError('An unexpected error occurred during import.');
    } finally {
      setImportLoading(false);
    }
  };

  const resetImport = () => {
    setFile(null);
    setImportFormat(null);
    setImportError(null);
    setImportSuccessCount(null);
  };

  const handleSave = () => {
    onSave({
      ...config,
      listColumns,
      cardFields,
      sortFields,
      theme,
      viewPreferences: viewPreferences as any
    });
  };

  const renderConfigSection = (
    title: string,
    currentList: string[],
    setList: (l: string[]) => void
  ) => {
    const availableToAdd = AVAILABLE_FIELDS.filter(f => !currentList.includes(f.id));

    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Active Fields (Drag/Order)</h4>
          <div className="space-y-2">
            {currentList.map((fieldId, idx) => {
              const fieldDef = AVAILABLE_FIELDS.find(f => f.id === fieldId);
              return (
                <div key={fieldId} className="flex items-center justify-between p-3 bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-xl">
                  <span className="text-sm font-bold text-tzeentch-text">{fieldDef?.label || fieldId}</span>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => moveItem(currentList, setList, idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 text-tzeentch-cyan/40 hover:text-tzeentch-cyan disabled:opacity-30 transition-colors"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button 
                      onClick={() => moveItem(currentList, setList, idx, 'down')}
                      disabled={idx === currentList.length - 1}
                      className="p-1 text-tzeentch-cyan/40 hover:text-tzeentch-cyan disabled:opacity-30 transition-colors"
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button 
                      onClick={() => removeItem(currentList, setList, idx)}
                      className="p-1 text-tzeentch-magenta/40 hover:text-tzeentch-magenta transition-colors ml-2"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
            {currentList.length === 0 && (
              <p className="text-sm text-tzeentch-text-faint italic p-4 text-center border border-dashed border-tzeentch-cyan/20 rounded-xl">No fields selected.</p>
            )}
          </div>
        </div>

        {availableToAdd.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Available Fields</h4>
            <div className="flex flex-wrap gap-2">
              {availableToAdd.map(field => (
                <button
                  key={field.id}
                  onClick={() => addItem(currentList, setList, field.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-tzeentch-card border border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40 text-tzeentch-cyan text-xs font-bold rounded-lg transition-all"
                >
                  <Plus size={14} />
                  {field.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSortSection = () => {
    const availableToAdd = AVAILABLE_FIELDS.filter(f => !sortFields.find(sf => sf.id === f.id));

    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Sort Priority (Drag/Order)</h4>
          <div className="space-y-2">
            {sortFields.map((field, idx) => {
              const fieldDef = AVAILABLE_FIELDS.find(f => f.id === field.id);
              const label = field.id === 'title' ? 'Title' : (fieldDef?.label || field.id);
              return (
                <div key={field.id} className="flex items-center justify-between p-3 bg-tzeentch-card/50 border border-tzeentch-cyan/20 rounded-xl">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-tzeentch-text">{label}</span>
                    <button 
                      onClick={() => toggleSortDirection(idx)}
                      className="px-2 py-1 bg-tzeentch-cyan/10 text-tzeentch-cyan text-[10px] font-bold rounded uppercase tracking-widest hover:bg-tzeentch-cyan/20 transition-colors"
                    >
                      {field.direction === 'asc' ? 'Ascending' : 'Descending'}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => moveSortItem(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 text-tzeentch-cyan/40 hover:text-tzeentch-cyan disabled:opacity-30 transition-colors"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button 
                      onClick={() => moveSortItem(idx, 'down')}
                      disabled={idx === sortFields.length - 1}
                      className="p-1 text-tzeentch-cyan/40 hover:text-tzeentch-cyan disabled:opacity-30 transition-colors"
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button 
                      onClick={() => removeSortItem(idx)}
                      className="p-1 text-tzeentch-magenta/40 hover:text-tzeentch-magenta transition-colors ml-2"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
            {sortFields.length === 0 && (
              <p className="text-sm text-tzeentch-text-faint italic p-4 text-center border border-dashed border-tzeentch-cyan/20 rounded-xl">No sort fields selected.</p>
            )}
          </div>
        </div>

        {availableToAdd.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Available Fields</h4>
            <div className="flex flex-wrap gap-2">
              {availableToAdd.map(field => {
                const label = field.id === 'title' ? 'Title' : field.label;
                return (
                  <button
                    key={field.id}
                    onClick={() => addSortItem(field.id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-tzeentch-card border border-tzeentch-cyan/10 hover:border-tzeentch-cyan/40 text-tzeentch-cyan text-xs font-bold rounded-lg transition-all"
                  >
                    <Plus size={14} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-tzeentch-overlay backdrop-blur-md"
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-tzeentch-bg w-full max-w-2xl rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[90vh] border border-tzeentch-cyan/30"
      >
        <div className="p-6 border-b border-tzeentch-cyan/10 flex justify-between items-center bg-tzeentch-card/30">
          <h2 className="text-xl font-bold text-tzeentch-cyan uppercase tracking-widest">Settings</h2>
          <button onClick={onClose} className="text-tzeentch-cyan/40 hover:text-tzeentch-magenta transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex border-b border-tzeentch-cyan/10 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveTab('card')}
            className={`flex-1 min-w-[100px] py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === 'card' ? 'text-tzeentch-cyan border-b-2 border-tzeentch-cyan bg-tzeentch-cyan/5' : 'text-tzeentch-text-faint hover:text-tzeentch-cyan/70'}`}
          >
            Card View
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 min-w-[100px] py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === 'list' ? 'text-tzeentch-cyan border-b-2 border-tzeentch-cyan bg-tzeentch-cyan/5' : 'text-tzeentch-text-faint hover:text-tzeentch-cyan/70'}`}
          >
            List View
          </button>
          <button
            onClick={() => setActiveTab('sort')}
            className={`flex-1 min-w-[100px] py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === 'sort' ? 'text-tzeentch-cyan border-b-2 border-tzeentch-cyan bg-tzeentch-cyan/5' : 'text-tzeentch-text-faint hover:text-tzeentch-cyan/70'}`}
          >
            Sort Order
          </button>
          <button
            onClick={() => setActiveTab('theme')}
            className={`flex-1 min-w-[100px] py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === 'theme' ? 'text-tzeentch-cyan border-b-2 border-tzeentch-cyan bg-tzeentch-cyan/5' : 'text-tzeentch-text-faint hover:text-tzeentch-cyan/70'}`}
          >
            Theme
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 min-w-[100px] py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === 'import' ? 'text-tzeentch-cyan border-b-2 border-tzeentch-cyan bg-tzeentch-cyan/5' : 'text-tzeentch-text-faint hover:text-tzeentch-cyan/70'}`}
          >
            Import
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'list' ? (
              <motion.div key="list" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                {renderConfigSection('List View Columns', listColumns, setListColumns)}
              </motion.div>
            ) : activeTab === 'card' ? (
              <motion.div key="card" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                {renderConfigSection('Card View Fields', cardFields, setCardFields)}
              </motion.div>
            ) : activeTab === 'sort' ? (
              <motion.div key="sort" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                {renderSortSection()}
              </motion.div>
            ) : activeTab === 'theme' ? (
              <motion.div key="theme" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="space-y-6">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Color Scheme</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <button
                      onClick={() => setTheme('system')}
                      className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${theme === 'system' ? 'border-tzeentch-cyan bg-tzeentch-cyan/10 text-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'border-tzeentch-cyan/20 bg-tzeentch-card/50 text-tzeentch-text-muted hover:border-tzeentch-cyan/50'}`}
                    >
                      <Monitor size={24} />
                      <span className="text-sm font-bold uppercase tracking-widest">System</span>
                    </button>
                    <button
                      onClick={() => setTheme('light')}
                      className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${theme === 'light' ? 'border-tzeentch-cyan bg-tzeentch-cyan/10 text-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'border-tzeentch-cyan/20 bg-tzeentch-card/50 text-tzeentch-text-muted hover:border-tzeentch-cyan/50'}`}
                    >
                      <Sun size={24} />
                      <span className="text-sm font-bold uppercase tracking-widest">Light</span>
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${theme === 'dark' ? 'border-tzeentch-cyan bg-tzeentch-cyan/10 text-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'border-tzeentch-cyan/20 bg-tzeentch-card/50 text-tzeentch-text-muted hover:border-tzeentch-cyan/50'}`}
                    >
                      <Moon size={24} />
                      <span className="text-sm font-bold uppercase tracking-widest">Dark</span>
                    </button>
                  </div>

                  <div className="space-y-4 pt-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/40">Pane View Preferences</h4>
                    <div className="space-y-3">
                      {['Reading', 'Read', 'Backlog', 'Wishlist', 'Dropped'].map((status) => (
                        <div key={status} className="flex items-center justify-between p-3 bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-xl">
                          <span className="text-sm font-bold text-tzeentch-text">{status}</span>
                          <div className="flex bg-tzeentch-bg p-1 rounded-lg border border-tzeentch-cyan/10">
                            {status === 'Dropped' && (
                              <button 
                                onClick={() => setViewPreferences(prev => ({ ...prev, [status]: 'show-with-read' }))}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-2 ${viewPreferences[status] === 'show-with-read' ? 'bg-tzeentch-gold text-tzeentch-bg shadow-[0_0_10px_rgba(255,187,0,0.4)]' : 'text-tzeentch-cyan/40 hover:text-tzeentch-gold'}`}
                              >
                                <Combine size={14} /> SHOW WITH READ
                              </button>
                            )}
                            <button 
                              onClick={() => setViewPreferences(prev => ({ ...prev, [status]: 'cards' }))}
                              className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-2 ${viewPreferences[status] === 'cards' ? 'bg-tzeentch-cyan text-tzeentch-bg shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 'text-tzeentch-cyan/40 hover:text-tzeentch-cyan'}`}
                            >
                              <LayoutGrid size={14} /> CARDS
                            </button>
                            <button 
                              onClick={() => setViewPreferences(prev => ({ ...prev, [status]: 'list' }))}
                              className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-2 ${viewPreferences[status] === 'list' ? 'bg-tzeentch-cyan text-tzeentch-bg shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 'text-tzeentch-cyan/40 hover:text-tzeentch-cyan'}`}
                            >
                              <List size={14} /> LIST
                            </button>
                            <button 
                              onClick={() => setViewPreferences(prev => ({ ...prev, [status]: 'disabled' }))}
                              className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-2 ${viewPreferences[status] === 'disabled' ? 'bg-tzeentch-magenta text-tzeentch-bg shadow-[0_0_10px_rgba(255,0,255,0.4)]' : 'text-tzeentch-cyan/40 hover:text-tzeentch-magenta'}`}
                            >
                              <EyeOff size={14} /> DISABLED
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="import" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="space-y-6">
                  {importSuccessCount !== null ? (
                    <div className="text-center py-6 space-y-4">
                      <div className="w-16 h-16 bg-tzeentch-cyan/10 text-tzeentch-cyan rounded-full flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                        <Check size={32} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-tzeentch-cyan">RITUAL COMPLETE</h3>
                        <p className="text-tzeentch-text-muted font-medium mt-1">Successfully bound {importSuccessCount} tomes to your archives.</p>
                      </div>
                      <button 
                        onClick={resetImport}
                        className="w-full py-3 bg-tzeentch-cyan text-tzeentch-bg rounded-xl font-bold hover:bg-tzeentch-cyan/80 transition-colors shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                      >
                        IMPORT MORE
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className={`
                          border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
                          ${file ? 'border-tzeentch-cyan bg-tzeentch-cyan/5' : 'border-tzeentch-cyan/20 hover:border-tzeentch-cyan/40 hover:bg-tzeentch-cyan/5'}
                        `}
                      >
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileChange} 
                          accept=".csv" 
                          className="hidden" 
                        />
                        <div className="w-12 h-12 bg-tzeentch-cyan/10 rounded-full flex items-center justify-center mx-auto mb-4 text-tzeentch-cyan">
                          {file ? <FileText size={24} /> : <Upload size={24} />}
                        </div>
                        {file ? (
                          <div>
                            <p className="font-bold text-tzeentch-cyan truncate px-4">{file.name}</p>
                            <p className="text-xs text-tzeentch-cyan/40 font-bold mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                          </div>
                        ) : (
                          <div>
                            <p className="font-bold text-tzeentch-cyan">OFFER GOODREADS CSV</p>
                            <p className="text-xs text-tzeentch-text-faint font-medium mt-1">
                              Sacrifice your Goodreads data to the Warp.
                            </p>
                          </div>
                        )}
                      </div>

                      {importError && (
                        <div className="flex items-center gap-2 p-3 bg-red-900/20 text-red-400 rounded-xl text-sm font-bold border border-red-900/30">
                          <AlertCircle size={16} />
                          <span>{importError}</span>
                        </div>
                      )}

                      <div className="space-y-3">
                        <p className="text-xs font-bold text-tzeentch-cyan/60 uppercase tracking-widest px-1">Import As</p>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={() => setImportFormat(importFormat === 'Book' ? null : 'Book')}
                            className={`
                              py-3 rounded-xl font-bold text-xs transition-all border
                              ${importFormat === 'Book' 
                                ? 'bg-tzeentch-cyan text-tzeentch-bg border-tzeentch-cyan shadow-[0_0_15px_rgba(34,211,238,0.3)]' 
                                : 'bg-tzeentch-card/30 text-tzeentch-cyan/60 border-tzeentch-cyan/10 hover:border-tzeentch-cyan/30'}
                            `}
                          >
                            BOOK
                          </button>
                          <button
                            onClick={() => setImportFormat(importFormat === 'Audiobook' ? null : 'Audiobook')}
                            className={`
                              py-3 rounded-xl font-bold text-xs transition-all border
                              ${importFormat === 'Audiobook' 
                                ? 'bg-tzeentch-magenta text-white border-tzeentch-magenta shadow-[0_0_15px_rgba(217,70,239,0.3)]' 
                                : 'bg-tzeentch-card/30 text-tzeentch-magenta/60 border-tzeentch-magenta/10 hover:border-tzeentch-magenta/30'}
                            `}
                          >
                            AUDIOBOOK
                          </button>
                        </div>
                        <p className="text-[10px] text-tzeentch-text-faint font-medium px-1">
                          {importFormat 
                            ? `All entries will be imported as ${importFormat.toLowerCase()}s.` 
                            : 'Use Goodreads binding info (default).'}
                        </p>
                      </div>

                      <button 
                        disabled={!file || importLoading}
                        onClick={handleImport}
                        className="w-full py-4 bg-tzeentch-cyan text-tzeentch-bg rounded-xl font-bold hover:bg-tzeentch-cyan/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                      >
                        {importLoading ? <Loader2 size={20} className="animate-spin" /> : <Check size={20} />}
                        {importLoading ? 'ABSORBING...' : 'START RITUAL'}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-6 border-t border-tzeentch-cyan/10 bg-tzeentch-card/30 flex justify-end gap-4">
          <button 
            onClick={onClose}
            className="px-6 py-2 rounded-xl text-sm font-bold text-tzeentch-cyan/60 hover:text-tzeentch-cyan transition-colors uppercase tracking-widest"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="px-6 py-2 bg-tzeentch-cyan text-tzeentch-bg rounded-xl text-sm font-bold hover:bg-tzeentch-cyan/80 transition-colors shadow-[0_0_15px_rgba(34,211,238,0.3)] uppercase tracking-widest"
          >
            Save Configuration
          </button>
        </div>
      </motion.div>
    </div>
  );
}
