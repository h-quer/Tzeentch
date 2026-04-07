import React, { useMemo } from 'react';
import { Book } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';
import { motion } from 'motion/react';

interface OverviewPanelProps {
  books: Book[];
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

export default function OverviewPanel({ books, viewPreferences }: OverviewPanelProps) {
  const stats = useMemo(() => {
    // 1. Category counts
    const categories = {
      Reading: 0,
      Read: 0,
      Backlog: 0,
      Wishlist: 0,
      Dropped: 0,
    };
    
    // 2. Format counts
    const formats = {
      Book: 0,
      Audiobook: 0,
    };

    // 3. Tag counts
    const tagCounts: Record<string, number> = {};

    // 4. Finished reading per year
    const finishedYears: Record<string, number> = {};

    // 5. Author counts
    const authorCounts: Record<string, number> = {};

    books.forEach(book => {
      // Categories
      if (categories[book.status as keyof typeof categories] !== undefined) {
        categories[book.status as keyof typeof categories]++;
      }

      // Formats
      if (book.format === 'Book' || book.format === 'Audiobook') {
        formats[book.format]++;
      }

      // Tags
      if (book.tags) {
        const tags = book.tags.split(',').map(t => t.trim()).filter(t => t);
        tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }

      // Finished reading
      if (book.status === 'Read' && book.finished_reading) {
        const year = book.finished_reading.substring(0, 4);
        if (year && !isNaN(Number(year))) {
          finishedYears[year] = (finishedYears[year] || 0) + 1;
        }
      }

      // Authors
      if (book.author) {
        authorCounts[book.author] = (authorCounts[book.author] || 0) + 1;
      }
    });

    const categoryData = Object.entries(categories)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));

    const formatData = Object.entries(formats).map(([name, value]) => ({ name, value }));

    const topTags = Object.entries(tagCounts)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    const currentYear = new Date().getFullYear();
    const last8Years = Array.from({ length: 8 }, (_, i) => (currentYear - 7 + i).toString());
    const yearData = last8Years
      .map(year => ({
        name: year,
        value: finishedYears[year] || 0
      }))
      .filter(item => item.value > 0);

    const topAuthors = Object.entries(authorCounts)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    return {
      categoryData,
      formatData,
      topTags,
      yearData,
      topAuthors
    };
  }, [books]);

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4">
      {/* Categories - Horizontal Bar Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-4 flex flex-col"
      >
        <h3 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-4">Items by Category</h3>
        <div className="h-64 w-full">
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
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-4 flex flex-col"
      >
        <h3 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-4">Books vs Audiobooks</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={stats.formatData}
                cx="50%"
                cy="45%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {stats.formatData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? '#22d3ee' : '#c026d3'} />
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
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-4 flex flex-col"
      >
        <h3 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-4">Top 8 Tags</h3>
        <div className="h-64 w-full">
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
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-4 flex flex-col"
      >
        <h3 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-4">Finished Reading (Last 8 Years)</h3>
        <div className="h-64 w-full">
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
        className="bg-tzeentch-card/30 border border-tzeentch-cyan/10 rounded-2xl p-4 flex flex-col lg:col-span-2"
      >
        <h3 className="text-xs font-bold uppercase tracking-widest text-tzeentch-cyan/60 mb-4">Top 8 Authors</h3>
        <div className="h-64 w-full">
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
