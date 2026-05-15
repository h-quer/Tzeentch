import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import Database from 'better-sqlite3';
import { Book } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Support DATABASE_PATH pointing to either end file, fallback to library.sqlite
let sqlitePath = process.env.DATABASE_PATH || path.resolve(dataDir, 'library.sqlite');
if (sqlitePath.endsWith('.csv')) {
  sqlitePath = sqlitePath.replace(/\.csv$/, '.sqlite');
}
const csvPath = path.resolve(dataDir, 'library.csv');

const HEADER_MAP: Record<string, string> = {
  id: 'ID',
  title: 'Book Name',
  author: 'Author',
  narrator: 'Narrator',
  series: 'Book Series',
  series_number: 'Series Number',
  published_date: 'Release Date',
  metadata_source: 'Metadata Source',
  tags: 'Tags',
  description: 'Summary',
  isbn: 'ISBN',
  asin: 'ASIN',
  started_reading: 'Date Started Reading',
  finished_reading: 'Date Finished Reading',
  status: 'Status',
  format: 'Format',
  rating: 'Rating',
  cover_url: 'Cover URL',
  page_count: 'Page Count',
  publisher: 'Publisher',
  notes: 'Notes'
};

const REVERSE_HEADER_MAP = Object.fromEntries(
  Object.entries(HEADER_MAP).map(([k, v]) => [v, k])
);

// Initialize DB
const db = new Database(sqlitePath);
db.pragma('journal_mode = WAL');

// Create essential schema first
db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    author TEXT,
    narrator TEXT,
    series TEXT,
    series_number TEXT,
    published_date TEXT,
    metadata_source TEXT,
    tags TEXT,
    description TEXT,
    isbn TEXT,
    asin TEXT,
    started_reading TEXT,
    finished_reading TEXT,
    status TEXT CHECK(status IS NULL OR status IN ('Reading', 'Read', 'Backlog', 'Wishlist', 'Dropped')),
    format TEXT CHECK(format IS NULL OR format IN ('Book', 'Audiobook')),
    rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),
    cover_url TEXT,
    page_count INTEGER CHECK(page_count IS NULL OR page_count > 0),
    publisher TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS book_tags (
    book_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (book_id, tag_id),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_status ON books(status);
  CREATE INDEX IF NOT EXISTS idx_rating ON books(rating);
  CREATE INDEX IF NOT EXISTS idx_format ON books(format);
  CREATE INDEX IF NOT EXISTS idx_author ON books(author);
  CREATE INDEX IF NOT EXISTS idx_started_reading ON books(started_reading);
  CREATE INDEX IF NOT EXISTS idx_finished_reading ON books(finished_reading);
`);

const syncTagsStmt = {
  delete: db.prepare('DELETE FROM book_tags WHERE book_id = ?'),
  insertTag: db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)'),
  getTagId: db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE'),
  insertLink: db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)')
};

const syncTags = (bookId: number, tagsString?: string | null, tagCache?: Map<string, number>) => {
  syncTagsStmt.delete.run(bookId);
  if (!tagsString) return;
  const tags = Array.from(new Set(tagsString.split(',').map(t => t.trim()).filter(Boolean)));
  for (const tag of tags) {
    const normalizedTag = tag.toLowerCase();
    let tagId = tagCache?.get(normalizedTag);
    
    if (!tagId) {
      syncTagsStmt.insertTag.run(tag);
      const idRow = syncTagsStmt.getTagId.get(tag) as { id: number };
      if (idRow) {
        tagId = idRow.id;
        tagCache?.set(normalizedTag, tagId);
      }
    }
    
    if (tagId) {
      syncTagsStmt.insertLink.run(bookId, tagId);
    }
  }
};

const ensureValidRating = (rating: any): number | null => {
  if (rating === null || rating === undefined || rating === '') return null;
  const r = Number(rating);
  if (isNaN(r) || r < 1 || r > 5) return null;
  return r;
};

// Migration Logic
const rowCount = db.prepare('SELECT COUNT(*) as count FROM books').get() as { count: number };
if (rowCount.count === 0 && fs.existsSync(csvPath)) {
  console.log('Migrating data from CSV to SQLite...');
  try {
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const result = Papa.parse(csvData, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true
    });
    
    const itemsToMigrate = (result.data as any[]).map(row => {
      const book: any = {};
      for (const [csvHeader, value] of Object.entries(row)) {
        const internalKey = REVERSE_HEADER_MAP[csvHeader];
        if (internalKey) {
          book[internalKey] = value === '' && internalKey !== 'notes' ? null : value;
        }
      }
      return { book, originalRow: row };
    });

    if (itemsToMigrate.length > 0) {
      const insert = db.prepare(`
        INSERT INTO books (
          id, title, author, narrator, series, series_number, published_date, metadata_source, tags, description, isbn, asin, started_reading, finished_reading, status, format, rating, cover_url, page_count, publisher, notes
        ) VALUES (
          @id, @title, @author, @narrator, @series, @series_number, @published_date, @metadata_source, @tags, @description, @isbn, @asin, @started_reading, @finished_reading, @status, @format, @rating, @cover_url, @page_count, @publisher, @notes
        )
      `);

      const failedCsvRows: any[] = [];
      const insertMany = db.transaction((items) => {
        for (const item of items) {
          const book = item.book;
          try {
            const info = insert.run({
              id: book.id || null,
              title: book.title || null,
              author: book.author || null,
              narrator: book.narrator || null,
              series: book.series || null,
              series_number: book.series_number?.toString() || null,
              published_date: book.published_date?.toString() || null,
              metadata_source: book.metadata_source || null,
              tags: book.tags || null,
              description: book.description || null,
              isbn: book.isbn?.toString() || null,
              asin: book.asin?.toString() || null,
              started_reading: book.started_reading || null,
              finished_reading: book.finished_reading || null,
              status: book.status || null,
              format: book.format || null,
              rating: book.rating ? Number(book.rating) : null,
              cover_url: book.cover_url || null,
              page_count: book.page_count ? Number(book.page_count) : null,
              publisher: book.publisher || null,
              notes: book.notes || null
            });
            const insertedId = book.id || Number(info.lastInsertRowid);
            if (book.tags) {
              syncTags(insertedId, book.tags);
            }
          } catch (err: any) {
             console.warn(`Skipping book "${book.title || book.id || 'Unknown'}" due to constraint failure: ${err.message}`);
             failedCsvRows.push(item.originalRow);
          }
        }
      });
      
      insertMany(itemsToMigrate);
      console.log(`Migrated ${itemsToMigrate.length - failedCsvRows.length} books successfully by passing strict layout constraints.`);
      
      if (failedCsvRows.length > 0) {
        const failedCsv = Papa.unparse(failedCsvRows);
        const failedPath = path.resolve(dataDir, 'library.failed_import.csv');
        fs.writeFileSync(failedPath, failedCsv, 'utf8');
        console.warn(`Exported ${failedCsvRows.length} failing rows directly cleanly to backup: ${failedPath}`);
      }
    }
    fs.renameSync(csvPath, csvPath + '.bak');
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

export interface GetBooksOptions {
  statuses?: string[];
  tag?: string;
  sortFields?: { id: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

export const getStats = () => {
  const currentYear = new Date().getFullYear();
  const last8Years = Array.from({ length: 8 }, (_, i) => (currentYear - 7 + i).toString());

  // Categories
  const categoryData = db.prepare(`
    SELECT status as name, COUNT(*) as value 
    FROM books 
    WHERE status IN ('Reading', 'Read', 'Backlog', 'Wishlist', 'Dropped') 
    GROUP BY status
    ORDER BY CASE status
      WHEN 'Reading' THEN 1
      WHEN 'Read' THEN 2
      WHEN 'Backlog' THEN 3
      WHEN 'Wishlist' THEN 4
      WHEN 'Dropped' THEN 5
      ELSE 6
    END ASC
  `).all() as {name: string, value: number}[];

  // Formats
  const formatData = db.prepare(`SELECT format as name, COUNT(*) as value FROM books WHERE format IN ('Book', 'Audiobook') GROUP BY format`).all() as {name: string, value: number}[];

  // Top Tags
  const topTags = db.prepare(`
    SELECT t.name, COUNT(*) as value 
    FROM tags t 
    JOIN book_tags bt ON t.id = bt.tag_id 
    GROUP BY t.id 
    ORDER BY value DESC 
    LIMIT 8
  `).all() as {name: string, value: number}[];

  // Finished Reading per Year (only Read status)
  const allYears = db.prepare(`
    SELECT substr(finished_reading, 1, 4) as name, COUNT(*) as value 
    FROM books 
    WHERE status = 'Read' AND finished_reading IS NOT NULL AND substr(finished_reading, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
    GROUP BY substr(finished_reading, 1, 4)
  `).all() as {name: string, value: number}[];
  
  const yearDataMap = Object.fromEntries(allYears.map(y => [y.name, y.value]));
  const yearData = last8Years
    .map(year => ({ name: year, value: yearDataMap[year] || 0 }))
    .filter(item => item.value > 0);

  // Top Authors
  const topAuthors = db.prepare(`SELECT author as name, COUNT(*) as value FROM books WHERE author IS NOT NULL GROUP BY author ORDER BY value DESC LIMIT 8`).all() as {name: string, value: number}[];

  return {
    categoryData,
    formatData,
    topTags,
    yearData,
    topAuthors
  };
};

const mapRowToBook = (row: any): Book => {
  return {
    ...row,
    id: Number(row.id),
    rating: row.rating ? Number(row.rating) : undefined,
    page_count: row.page_count ? Number(row.page_count) : undefined,
  } as Book;
};

export const getBooks = (options: GetBooksOptions = {}) => {
  let query = `SELECT b.* FROM books b`;
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (options.tag) {
     query += ` JOIN book_tags bt ON bt.book_id = b.id JOIN tags t ON t.id = bt.tag_id`;
     conditions.push(`t.name = ?`);
     params.push(options.tag);
  }
  
  if (options.statuses && options.statuses.length > 0) {
     const marks = options.statuses.map(() => '?').join(',');
     conditions.push(`b.status IN (${marks})`);
     params.push(...options.statuses);
  }
  
  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(' AND ');
  }
  
  const sortMap: Record<string, string> = {
    'id': 'b.id',
    'title': 'b.title',
    'author': 'b.author',
    'rating': 'b.rating',
    'started_reading': 'b.started_reading',
    'finished_reading': 'b.finished_reading',
    'series': 'b.series, CAST(b.series_number AS REAL)'
  };
  
  let orderClauses: string[] = [];
  if (options.sortFields && options.sortFields.length > 0) {
    for (const sort of options.sortFields) {
      if (sortMap[sort.id]) {
        const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
        orderClauses.push(`${sortMap[sort.id]} ${dir}`);
      }
    }
  }
  
  if (orderClauses.length === 0) {
     orderClauses.push('b.id DESC'); // Default fallback
  }
  
  query += ` ORDER BY ` + orderClauses.join(', ');
  
  if (options.limit !== undefined) {
    query += ` LIMIT ?`;
    params.push(options.limit);
    if (options.offset !== undefined) {
      query += ` OFFSET ?`;
      params.push(options.offset);
    }
  }

  const rows = db.prepare(query).all(...params);
  return rows.map(mapRowToBook);
};

export const globalSearch = (query: string, limit: number = 10) => {
  const likeQuery = `%${query}%`;
  
  const sql = `
    SELECT b.*,
      CASE 
        WHEN b.title LIKE ? THEN 100
        WHEN b.title LIKE ? THEN 90
        WHEN b.author LIKE ? THEN 80
        WHEN EXISTS (SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = b.id AND t.name LIKE ?) THEN 70
        WHEN b.description LIKE ? THEN 60
        ELSE 50
      END as rank
    FROM books b
    WHERE b.title LIKE ? OR b.author LIKE ? OR b.description LIKE ? OR EXISTS (SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = b.id AND t.name LIKE ?)
    ORDER BY rank DESC, b.id DESC
    LIMIT ?
  `;

  // Start matches: %query%
  // Exact or very close matches can be tweaked, but using LIKE for all and ranking is good enough.
  const startLike = `${query}%`;
  
  const rows = db.prepare(sql).all(
    startLike, likeQuery, likeQuery, likeQuery, likeQuery,
    likeQuery, likeQuery, likeQuery, likeQuery,
    limit
  );
  
  return rows.map((r: any) => {
    delete r.rank;
    return mapRowToBook(r);
  });
};

export const getBookById = (id: number) => {
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  return row ? mapRowToBook(row) : undefined;
};

export const addBook = (book: Omit<Book, 'id'>) => {
  const normalizedBook = { ...book };
  if ('rating' in normalizedBook) {
    normalizedBook.rating = ensureValidRating(normalizedBook.rating) as any;
  }
  
  const fields = Object.keys(normalizedBook).filter(k => k !== 'id');
  if (fields.length === 0) {
     const stmt = db.prepare('INSERT INTO books DEFAULT VALUES');
     const r = stmt.run();
     cachedTags = null;
     return Number(r.lastInsertRowid);
  }
  const placeholders = fields.map(() => '?').join(', ');
  
  const stmt = db.prepare(`INSERT INTO books (${fields.join(', ')}) VALUES (${placeholders})`);
  const values = fields.map(k => (normalizedBook as any)[k] ?? null);
  
  const result = stmt.run(...values);
  const newId = Number(result.lastInsertRowid);
  if ('tags' in normalizedBook) {
    syncTags(newId, normalizedBook.tags);
  }
  cachedTags = null;
  return newId;
};

const ALL_BOOK_FIELDS = [
  'title', 'author', 'narrator', 'series', 'series_number', 
  'published_date', 'metadata_source', 'tags', 'description', 
  'isbn', 'asin', 'started_reading', 'finished_reading', 
  'status', 'format', 'rating', 'cover_url', 'page_count', 
  'publisher', 'notes'
];

export const addBooks = (newBooks: Omit<Book, 'id'>[]) => {
  if (newBooks.length === 0) return [];
  
  const normalizedBooks = newBooks.map(book => ({
    ...book,
    rating: ensureValidRating(book.rating)
  }));
  
  const addedBooks: Book[] = [];
  
  const insert = db.prepare(`
    INSERT INTO books (${ALL_BOOK_FIELDS.join(', ')}) 
    VALUES (${ALL_BOOK_FIELDS.map(() => '?').join(', ')})
  `);

  const insertMany = db.transaction((books) => {
    const tagCache = new Map<string, number>();
    for (const book of books) {
      const values = ALL_BOOK_FIELDS.map(k => (book as any)[k] ?? null);
      const result = insert.run(...values);
      const newId = Number(result.lastInsertRowid);
      addedBooks.push({ ...book, id: newId } as Book);
      if ('tags' in book) {
        syncTags(newId, book.tags, tagCache);
      }
    }
  });

  insertMany(normalizedBooks);
  cachedTags = null;
  return addedBooks;
};

export const updateBook = (id: number, updates: Partial<Book>) => {
  const normalizedUpdates = { ...updates };
  if ('rating' in normalizedUpdates) {
    normalizedUpdates.rating = ensureValidRating(normalizedUpdates.rating) as any;
  }
  
  const fields = Object.keys(normalizedUpdates).filter(k => k !== 'id');
  if (fields.length === 0) return false;
  
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(k => (normalizedUpdates as any)[k] ?? null);
  values.push(id); 
  
  const updateStmt = db.prepare(`UPDATE books SET ${setClause} WHERE id = ?`);
  
  const transaction = db.transaction(() => {
    const result = updateStmt.run(...values);
    if (result.changes > 0) {
      if ('tags' in normalizedUpdates) {
        syncTags(id, (normalizedUpdates as any).tags);
      }
      cachedTags = null;
      return true;
    }
    return false;
  });

  return transaction();
};

export const updateBooks = (ids: number[], updates: Partial<Book>) => {
  if (ids.length === 0) return false;
  
  const normalizedUpdates = { ...updates };
  if ('rating' in normalizedUpdates) {
    normalizedUpdates.rating = ensureValidRating(normalizedUpdates.rating) as any;
  }
  
  const fields = Object.keys(normalizedUpdates).filter(k => k !== 'id');
  if (fields.length === 0) return false;
  
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const baseValues = fields.map(k => (normalizedUpdates as any)[k] ?? null);
  
  const stmt = db.prepare(`UPDATE books SET ${setClause} WHERE id = ?`);
  
  let changes = 0;
  const updateMany = db.transaction((idsList: number[]) => {
    for (const id of idsList) {
      const result = stmt.run(...baseValues, id);
      changes += result.changes;
      if (result.changes > 0 && 'tags' in normalizedUpdates) {
        syncTags(id, (normalizedUpdates as any).tags);
      }
    }
  });

  updateMany(ids);
  
  if (changes > 0) {
    cachedTags = null;
    return true;
  }
  return false;
};

/**
 * Performs multiple different updates and additions in a single transaction.
 * Optimized for sync operations.
 */
export const bulkSyncBooks = (toAdd: Omit<Book, 'id'>[], toUpdate: {id: number, updates: Partial<Book>}[]): {added: number, updated: number} => {
  let added = 0;
  let updated = 0;

  const transaction = db.transaction(() => {
    const tagCache = new Map<string, number>();

    // Handle Additions
    if (toAdd.length > 0) {
      const normalizedToAdd = toAdd.map(b => ({
        ...b,
        rating: ensureValidRating(b.rating)
      }));
      
      const insertStmt = db.prepare(`
        INSERT INTO books (${ALL_BOOK_FIELDS.join(', ')}) 
        VALUES (${ALL_BOOK_FIELDS.map(() => '?').join(', ')})
      `);

      for (const book of normalizedToAdd) {
        const values = ALL_BOOK_FIELDS.map(k => (book as any)[k] ?? null);
        const result = insertStmt.run(...values);
        const newId = Number(result.lastInsertRowid);
        if ('tags' in book) {
          syncTags(newId, book.tags, tagCache);
        }
        added++;
      }
    }

    // Handle Updates
    for (const item of toUpdate) {
      const normalizedUpdates = { ...item.updates };
      if ('rating' in normalizedUpdates) {
        normalizedUpdates.rating = ensureValidRating(normalizedUpdates.rating) as any;
      }
      
      const fields = Object.keys(normalizedUpdates).filter(k => k !== 'id');
      if (fields.length === 0) continue;

      const setClause = fields.map(field => `${field} = ?`).join(', ');
      const values = fields.map(k => (normalizedUpdates as any)[k] ?? null);
      values.push(item.id);

      const updateStmt = db.prepare(`UPDATE books SET ${setClause} WHERE id = ?`);
      const result = updateStmt.run(...values);
      if (result.changes > 0) {
        if ('tags' in normalizedUpdates) {
          syncTags(item.id, (normalizedUpdates as any).tags, tagCache);
        }
        updated++;
      }
    }
  });

  transaction();
  cachedTags = null;
  return { added, updated };
};

export const deleteBook = (id: number) => {
  const stmt = db.prepare('DELETE FROM books WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes > 0) {
    cachedTags = null;
    return true;
  }
  return false;
};

export const deleteBooks = (ids: number[]) => {
  if (ids.length === 0) return false;
  
  const stmt = db.prepare('DELETE FROM books WHERE id = ?');
  let changes = 0;
  
  const deleteMany = db.transaction((idsList: number[]) => {
    for (const id of idsList) {
      const result = stmt.run(id);
      changes += result.changes;
    }
  });

  deleteMany(ids);
  
  if (changes > 0) {
    cachedTags = null;
    return true;
  }
  return false;
};

export const exportDbToCsv = (): string => {
  const books = getBooks();
  const mappedBooks = books.map(book => {
    const row: any = {};
    for (const [internalKey, csvHeader] of Object.entries(HEADER_MAP)) {
      row[csvHeader] = (book as any)[internalKey];
    }
    return row;
  });
  return Papa.unparse({
    fields: Object.values(HEADER_MAP),
    data: mappedBooks
  });
};

let cachedTags: string[] | null = null;
let lastTagReadTime = 0;
const TAG_CACHE_TTL = 30000; // 30 seconds

export const getTags = () => {
  const now = Date.now();
  if (cachedTags && (now - lastTagReadTime < TAG_CACHE_TTL)) {
    return cachedTags;
  }
  
  const rows = db.prepare('SELECT name FROM tags ORDER BY name COLLATE NOCASE ASC').all() as {name: string}[];
  cachedTags = rows.map(r => r.name);
  
  lastTagReadTime = now;
  return cachedTags;
};

export default { getBooks, globalSearch, getBookById, addBook, addBooks, updateBook, updateBooks, deleteBook, deleteBooks, getTags, exportDbToCsv, getStats };
