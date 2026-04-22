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

  CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
    title, author, narrator, description, series, publisher, content='books', content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
    INSERT INTO books_fts(rowid, title, author, narrator, description, series, publisher)
    VALUES (new.id, new.title, new.author, new.narrator, new.description, new.series, new.publisher);
  END;
  CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, author, narrator, description, series, publisher)
    VALUES ('delete', old.id, old.title, old.author, old.narrator, old.description, old.series, old.publisher);
  END;
  CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, author, narrator, description, series, publisher)
    VALUES ('delete', old.id, old.title, old.author, old.narrator, old.description, old.series, old.publisher);
    INSERT INTO books_fts(rowid, title, author, narrator, description, series, publisher)
    VALUES (new.id, new.title, new.author, new.narrator, new.description, new.series, new.publisher);
  END;
`);

const syncTagsStmt = {
  delete: db.prepare('DELETE FROM book_tags WHERE book_id = ?'),
  insertTag: db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)'),
  getTagId: db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE'),
  insertLink: db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)')
};

const syncTags = (bookId: number, tagsString?: string | null) => {
  syncTagsStmt.delete.run(bookId);
  if (!tagsString) return;
  const tags = tagsString.split(',').map(t => t.trim()).filter(Boolean);
  for (const tag of tags) {
    syncTagsStmt.insertTag.run(tag);
    const idRow = syncTagsStmt.getTagId.get(tag) as { id: number };
    if (idRow) {
      syncTagsStmt.insertLink.run(bookId, idRow.id);
    }
  }
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
  search?: string;
  tag?: string;
  sortFields?: { id: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

export const getStats = () => {
  const currentYear = new Date().getFullYear();
  const last8Years = Array.from({ length: 8 }, (_, i) => (currentYear - 7 + i).toString());

  // Categories
  const categoryData = db.prepare(`SELECT status as name, COUNT(*) as value FROM books WHERE status IN ('Reading', 'Read', 'Backlog', 'Wishlist', 'Dropped') GROUP BY status`).all() as {name: string, value: number}[];

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
  
  if (options.search) {
     query += ` JOIN books_fts fts ON fts.rowid = b.id`;
     const matchQuery = options.search
        .replace(/[^a-zA-Z0-9\\s]/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map(word => `"${word}"*`)
        .join(' AND ');
     if (matchQuery) {
       conditions.push(`books_fts MATCH ?`);
       params.push(matchQuery);
     }
  }
  
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

export const getBookById = (id: number) => {
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  return row ? mapRowToBook(row) : undefined;
};

export const addBook = (book: Omit<Book, 'id'>) => {
  const fields = Object.keys(book).filter(k => k !== 'id');
  if (fields.length === 0) {
     const stmt = db.prepare('INSERT INTO books DEFAULT VALUES');
     const r = stmt.run();
     cachedTags = null;
     return Number(r.lastInsertRowid);
  }
  const placeholders = fields.map(() => '?').join(', ');
  
  const stmt = db.prepare(`INSERT INTO books (${fields.join(', ')}) VALUES (${placeholders})`);
  const values = fields.map(k => (book as any)[k] ?? null);
  
  const result = stmt.run(...values);
  const newId = Number(result.lastInsertRowid);
  if ('tags' in book) {
    syncTags(newId, book.tags);
  }
  cachedTags = null;
  return newId;
};

export const addBooks = (newBooks: Omit<Book, 'id'>[]) => {
  if (newBooks.length === 0) return [];
  
  const firstBookKeys = Object.keys(newBooks[0]).filter(k => k !== 'id');
  const addedBooks: Book[] = [];
  
  const insert = db.prepare(`
    INSERT INTO books (${firstBookKeys.join(', ')}) 
    VALUES (${firstBookKeys.map(() => '?').join(', ')})
  `);

  const insertMany = db.transaction((books) => {
    for (const book of books) {
      const values = firstBookKeys.map(k => (book as any)[k] ?? null);
      const result = insert.run(...values);
      const newId = Number(result.lastInsertRowid);
      addedBooks.push({ ...book, id: newId } as Book);
      if ('tags' in book) {
        syncTags(newId, book.tags);
      }
    }
  });

  insertMany(newBooks);
  cachedTags = null;
  return addedBooks;
};

export const updateBook = (id: number, updates: Partial<Book>) => {
  const fields = Object.keys(updates).filter(k => k !== 'id');
  if (fields.length === 0) return false;
  
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(k => (updates as any)[k] ?? null);
  values.push(id); 
  
  const stmt = db.prepare(`UPDATE books SET ${setClause} WHERE id = ?`);
  const result = stmt.run(...values);
  
  if (result.changes > 0) {
    if ('tags' in updates) {
      syncTags(id, updates.tags);
    }
    cachedTags = null;
    return true;
  }
  return false;
};

export const updateBooks = (ids: number[], updates: Partial<Book>) => {
  if (ids.length === 0) return false;
  
  const fields = Object.keys(updates).filter(k => k !== 'id');
  if (fields.length === 0) return false;
  
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const baseValues = fields.map(k => (updates as any)[k] ?? null);
  
  const stmt = db.prepare(`UPDATE books SET ${setClause} WHERE id = ?`);
  
  let changes = 0;
  const updateMany = db.transaction((idsList: number[]) => {
    for (const id of idsList) {
      const result = stmt.run(...baseValues, id);
      changes += result.changes;
      if (result.changes > 0 && 'tags' in updates) {
        syncTags(id, updates.tags);
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

export default { getBooks, getBookById, addBook, addBooks, updateBook, updateBooks, deleteBook, deleteBooks, getTags, exportDbToCsv, getStats };
