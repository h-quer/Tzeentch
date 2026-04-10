import React from 'react';
import { X, Github, Info } from 'lucide-react';
import { motion } from 'motion/react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
  if (!isOpen) return null;

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
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="relative w-full max-w-md bg-tzeentch-bg border border-tzeentch-cyan/30 rounded-2xl shadow-[0_0_50px_rgba(34,211,238,0.15)] overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-tzeentch-cyan/20 bg-tzeentch-card/30 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-tzeentch-cyan/10 rounded-full flex items-center justify-center text-tzeentch-cyan border border-tzeentch-cyan/20">
              <Info size={20} />
            </div>
            <h2 className="text-xl font-bold text-tzeentch-cyan tracking-tight tracking-widest">About Tzeentch</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-tzeentch-cyan/40 hover:text-tzeentch-cyan hover:bg-tzeentch-cyan/10 rounded-lg transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-tzeentch-cyan/10 pb-2">
              <span className="text-xs font-bold text-tzeentch-cyan/40 uppercase tracking-widest">Version</span>
              <span className="text-sm font-bold text-tzeentch-text">0.1</span>
            </div>
            
            <div className="flex justify-between items-center border-b border-tzeentch-cyan/10 pb-2">
              <span className="text-xs font-bold text-tzeentch-cyan/40 uppercase tracking-widest">Github</span>
              <a 
                href="https://github.com/h-quer/Tzeentch" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-tzeentch-cyan hover:text-tzeentch-magenta transition-colors flex items-center gap-2"
              >
                <Github size={16} />
                Repository
              </a>
            </div>

            <div className="border-b border-tzeentch-cyan/10 pb-2">
              <span className="text-xs font-bold text-tzeentch-cyan/40 uppercase tracking-widest block mb-2">Credits</span>
              <a 
                href="https://www.flaticon.com/free-icons/folder" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-sm font-medium text-tzeentch-text/90 hover:text-tzeentch-cyan transition-colors"
              >
                Folder icons created by juicy_fish - Flaticon
              </a>
            </div>

            <div className="pt-2">
              <p className="text-xs font-medium text-tzeentch-text-muted italic">
                Created using Google AI Studio
              </p>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-tzeentch-cyan text-tzeentch-bg font-bold hover:bg-tzeentch-cyan/80 transition-all shadow-[0_0_20px_rgba(34,211,238,0.2)] uppercase tracking-widest text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
