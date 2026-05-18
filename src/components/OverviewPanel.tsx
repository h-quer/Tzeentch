import React, { useState, useEffect } from 'react';
import { Book } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

interface OverviewPanelProps {
  books?: Book[]; // Kept for backwards compatibility but not strictly needed anymore
  viewPreferences?: Record<string, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
}

const COLORS = [
  '#22d3ee', // Tzeentch Cyan
  '#c026d3', // Warp Magenta
  '#fbbf24', // Eldritch Gold
  '#818cf8', // Indigo
  '#2dd4bf', // Teal
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#06b6d4'  // Darker Cyan
];

export default function OverviewPanel({ viewPreferences }: OverviewPanelProps) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    
    fetch('/api/stats', { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch stats');
        return res.json();
      })
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch stats:', err);
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-tzeentch-bg border border-tzeentch-cyan/30 p-2 rounded shadow-lg text-xs font-bold text-tzeentch-cyan">
          <p>{`${label || payload[0].name} : ${payload[0].value}`}</p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 className="animate-spin text-tzeentch-cyan w-10 h-10" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div 
      onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
      tabIndex={0}
      className="h-full overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-[1fr,1fr,1fr] gap-4 lg:gap-6 p-4 lg:p-6 focus-visible:ring-2 focus-visible:ring-tzeentch-cyan/50 focus-visible:ring-offset-4 focus-visible:ring-offset-tzeentch-bg transition-shadow outline-none rounded-xl"
    >
      {/* Categories - Horizontal Bar Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-3 lg:p-5 flex flex-col min-h-[300px] lg:min-h-0"
      >
        <h3 className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-2 lg:mb-4">Items by Category</h3>
        <div className="flex-1 w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.categoryData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#22d3ee" opacity={0.1} horizontal={false} />
              <XAxis type="number" stroke="#22d3ee" fontSize={12} tickLine={false} axisLine={false} scale="log" domain={[1, 'auto']} />
              <YAxis dataKey="name" type="category" stroke="#22d3ee" fontSize={12} tickLine={false} axisLine={false} width={80} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#22d3ee', opacity: 0.1 }} />
              <Bar dataKey="value" fill="#22d3ee" radius={[0, 4, 4, 0]}>
                {stats.categoryData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Formats - Pie Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-3 lg:p-5 flex flex-col min-h-[300px] lg:min-h-0"
      >
        <h3 className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-2 lg:mb-4">Books vs Audiobooks</h3>
        <div className="flex-1 w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={stats.formatData}
                cx="50%"
                cy="45%"
                innerRadius="40%"
                outerRadius="70%"
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {stats.formatData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={['#22d3ee', '#c026d3', '#f472b6'][index % 3]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                verticalAlign="bottom" 
                align="center"
                iconType="circle"
                formatter={(value, entry: any) => (
                  <span className="text-[10px] font-bold text-tzeentch-text-muted uppercase tracking-wider ml-1">
                    {value} ({entry.payload.value})
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Top Tags - Vertical Bar Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-3 lg:p-5 flex flex-col min-h-[300px] lg:min-h-0"
      >
        <h3 className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-2 lg:mb-4">Top 8 Tags</h3>
        <div className="flex-1 w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.topTags} margin={{ top: 5, right: 5, left: -20, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#22d3ee" opacity={0.1} vertical={false} />
              <XAxis dataKey="name" stroke="#22d3ee" fontSize={10} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={50} />
              <YAxis stroke="#22d3ee" fontSize={12} tickLine={false} axisLine={false} scale="log" domain={[1, 'auto']} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#22d3ee', opacity: 0.1 }} />
              <Bar dataKey="value" fill="#22d3ee" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Finished Reading per Year - Vertical Bar Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-3 lg:p-5 flex flex-col min-h-[300px] lg:min-h-0"
      >
        <h3 className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-2 lg:mb-4">Finished Reading (Last 8 Years)</h3>
        <div className="flex-1 w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.yearData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#fbbf24" opacity={0.1} vertical={false} />
              <XAxis dataKey="name" stroke="#fbbf24" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#fbbf24" fontSize={12} tickLine={false} axisLine={false} scale="log" domain={[1, 'auto']} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fbbf24', opacity: 0.1 }} />
              <Bar dataKey="value" fill="#fbbf24" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Top Authors - Bar Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-3 lg:p-5 flex flex-col min-h-[300px] lg:min-h-0 lg:col-span-2"
      >
        <h3 className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-2 lg:mb-4">Top 8 Authors</h3>
        <div className="flex-1 w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.topAuthors} margin={{ top: 5, right: 5, left: -20, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#c026d3" opacity={0.1} vertical={false} />
              <XAxis dataKey="name" stroke="#c026d3" fontSize={10} tickLine={false} axisLine={false} angle={-15} textAnchor="end" height={40} />
              <YAxis stroke="#c026d3" fontSize={12} tickLine={false} axisLine={false} scale="log" domain={[1, 'auto']} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#c026d3', opacity: 0.1 }} />
              <Bar dataKey="value" fill="#c026d3" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  );
}
