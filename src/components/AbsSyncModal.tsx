import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { UIConfig } from '../types';

interface AbsSyncModalProps {
  config: UIConfig;
  onClose: () => void;
  onConfigChange: (newConfig: UIConfig) => void;
  onSyncComplete: () => void;
}

export default function AbsSyncModal({ config, onClose, onConfigChange, onSyncComplete }: AbsSyncModalProps) {
  const [url, setUrl] = useState(config.absUrl || '');
  const [apiKey, setApiKey] = useState(config.absApiKey || '');
  const [libraryName, setLibraryName] = useState(config.absLibrary || '');
  const [syncMode, setSyncMode] = useState<'all' | 'from'>(config.lastAbsSyncDate ? 'from' : 'all');
  const [fromDate, setFromDate] = useState(config.lastAbsSyncDate || '');
  const [overwriteMode, setOverwriteMode] = useState<'empty-only' | 'dates-empty-only' | 'overwrite-all'>('empty-only');
  
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const hasChanges = url !== (config.absUrl || '') || apiKey !== (config.absApiKey || '') || libraryName !== (config.absLibrary || '');
  const canSync = !!config.absUrl && !!config.absApiKey && !hasChanges;

  const handleSaveConfig = async () => {
    setIsSaving(true);
    const newConfig = { ...config, absUrl: url, absApiKey: apiKey, absLibrary: libraryName };
    try {
      await fetch('/api/ui-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      onConfigChange(newConfig);
    } catch (error) {
      console.error('Failed to save config', error);
    } finally {
      setIsSaving(false);
    }
  };

  const performSync = async () => {
    setIsSyncing(true);
    setSyncMessage('Syncing with Audiobookshelf (this may take a while)...');
    
    try {
      // Send to backend to perform the entire sync
      const syncRes = await fetch('/api/abs-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          absUrl: config.absUrl,
          absApiKey: config.absApiKey,
          absLibrary: config.absLibrary,
          syncMode,
          fromDate,
          overwriteMode,
          timezoneOffset: new Date().getTimezoneOffset()
        })
      });
      
      const result = await syncRes.json();
      if (!syncRes.ok) throw new Error(result.error || 'Failed to sync with Audiobookshelf.');
      
      // Update last sync date
      const today = new Date().toISOString().split('T')[0];
      const newConfig = { ...config, lastAbsSyncDate: today };
      await fetch('/api/ui-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      onConfigChange(newConfig);
      
      setSyncMessage(`Sync completed! Added: ${result.added}, Updated: ${result.updated}`);
      setTimeout(() => {
        onSyncComplete();
        onClose();
      }, 3000);
      
    } catch (error: any) {
      console.error('Sync error:', error);
      setSyncMessage(`Error: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-tzeentch-bg/80 backdrop-blur-sm">
      <div className="bg-tzeentch-card border border-tzeentch-cyan/30 rounded-2xl shadow-[0_0_40px_rgba(34,211,238,0.15)] w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-tzeentch-cyan/20 bg-tzeentch-cyan/5">
          <h2 className="text-xl font-bold text-tzeentch-cyan tracking-tight flex items-center gap-2">
            <RefreshCw size={20} />
            Sync with Audiobookshelf
          </h2>
          <button onClick={onClose} className="text-tzeentch-text-muted hover:text-tzeentch-cyan transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* Credentials */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-tzeentch-cyan/80 mb-1">Audiobookshelf Server URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://audiobookshelf.example.com"
                className="w-full bg-tzeentch-bg border border-tzeentch-cyan/20 rounded-lg px-3 py-2 text-tzeentch-text focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-tzeentch-cyan/80 mb-1">Audiobookshelf API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API Key"
                className="w-full bg-tzeentch-bg border border-tzeentch-cyan/20 rounded-lg px-3 py-2 text-tzeentch-text focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-tzeentch-cyan/80 mb-1">Library (Optional)</label>
              <input
                type="text"
                value={libraryName}
                onChange={(e) => setLibraryName(e.target.value)}
                placeholder="e.g., Audiobooks"
                className="w-full bg-tzeentch-bg border border-tzeentch-cyan/20 rounded-lg px-3 py-2 text-tzeentch-text focus:outline-none focus:border-tzeentch-cyan/50 focus:ring-1 focus:ring-tzeentch-cyan/50"
              />
            </div>
            
            <div className="flex justify-end">
              <button
                onClick={handleSaveConfig}
                disabled={!hasChanges || isSaving}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  hasChanges 
                    ? 'bg-tzeentch-cyan text-tzeentch-bg hover:bg-tzeentch-cyan/80' 
                    : 'bg-tzeentch-cyan/10 text-tzeentch-cyan/50 cursor-not-allowed'
                }`}
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save Credentials'}
              </button>
            </div>
          </div>

          <div className="h-px bg-tzeentch-cyan/20 w-full" />

          {/* Sync Options */}
          <div className="space-y-4">
            <label className="block text-sm font-bold text-tzeentch-cyan/80 mb-2">Sync Options</label>
            
            <div className="space-y-3 mb-4 p-3 bg-tzeentch-bg/50 border border-tzeentch-cyan/10 rounded-lg">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  checked={overwriteMode === 'empty-only'}
                  onChange={() => setOverwriteMode('empty-only')}
                  className="mt-1 text-tzeentch-cyan focus:ring-tzeentch-cyan/50 bg-tzeentch-bg border-tzeentch-cyan/30"
                />
                <div>
                  <span className="text-sm font-bold text-tzeentch-text block">Sync only if empty</span>
                  <span className="text-xs text-tzeentch-text-muted">Only populates fields that currently have no value.</span>
                </div>
              </label>
              
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  checked={overwriteMode === 'dates-empty-only'}
                  onChange={() => setOverwriteMode('dates-empty-only')}
                  className="mt-1 text-tzeentch-cyan focus:ring-tzeentch-cyan/50 bg-tzeentch-bg border-tzeentch-cyan/30"
                />
                <div>
                  <span className="text-sm font-bold text-tzeentch-text block">Sync dates if empty, overwrite rest</span>
                  <span className="text-xs text-tzeentch-text-muted">Overwrites most metadata, but preserves existing reading dates.</span>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  checked={overwriteMode === 'overwrite-all'}
                  onChange={() => setOverwriteMode('overwrite-all')}
                  className="mt-1 text-tzeentch-cyan focus:ring-tzeentch-cyan/50 bg-tzeentch-bg border-tzeentch-cyan/30"
                />
                <div>
                  <span className="text-sm font-bold text-tzeentch-text block">Overwrite everything</span>
                  <span className="text-xs text-tzeentch-text-muted">Replaces all local metadata with data from Audiobookshelf.</span>
                </div>
              </label>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={syncMode === 'all'}
                  onChange={() => setSyncMode('all')}
                  className="text-tzeentch-cyan focus:ring-tzeentch-cyan/50 bg-tzeentch-bg border-tzeentch-cyan/30"
                />
                <span className="text-sm text-tzeentch-text">All</span>
              </label>
              
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={syncMode === 'from'}
                    onChange={() => setSyncMode('from')}
                    className="text-tzeentch-cyan focus:ring-tzeentch-cyan/50 bg-tzeentch-bg border-tzeentch-cyan/30"
                  />
                  <span className="text-sm text-tzeentch-text">From...</span>
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  disabled={syncMode !== 'from'}
                  className={`bg-tzeentch-bg border rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-tzeentch-cyan/50 ${
                    syncMode === 'from' ? 'border-tzeentch-cyan/40 text-tzeentch-text' : 'border-tzeentch-cyan/10 text-tzeentch-text-muted cursor-not-allowed'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Sync Action */}
          <div className="pt-4">
            <button
              onClick={performSync}
              disabled={!canSync || isSyncing}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold transition-all ${
                canSync
                  ? 'bg-tzeentch-magenta text-tzeentch-bg hover:bg-tzeentch-magenta/80 shadow-[0_0_15px_rgba(217,70,239,0.3)]'
                  : 'bg-tzeentch-magenta/10 text-tzeentch-magenta/50 cursor-not-allowed'
              }`}
            >
              <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
            
            {syncMessage && (
              <p className="mt-4 text-center text-sm text-tzeentch-cyan/80">{syncMessage}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
