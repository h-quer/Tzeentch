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

// Create table if not exists
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
    status TEXT,
    format TEXT,
    rating INTEGER,
    cover_url TEXT,
    page_count INTEGER,
    publisher TEXT,
    notes TEXT
  )
`);

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
    
    const booksToMigrate = (result.data as any[]).map(row => {
      const book: any = {};
      for (const [csvHeader, value] of Object.entries(row)) {
        const internalKey = REVERSE_HEADER_MAP[csvHeader];
        if (internalKey) {
          book[internalKey] = value === '' && internalKey !== 'notes' ? null : value;
        }
      }
      return book;
    });

    if (booksToMigrate.length > 0) {
      const insert = db.prepare(`
        INSERT INTO books (
          id, title, author, narrator, series, series_number, published_date, metadata_source, tags, description, isbn, asin, started_reading, finished_reading, status, format, rating, cover_url, page_count, publisher, notes
        ) VALUES (
          @id, @title, @author, @narrator, @series, @series_number, @published_date, @metadata_source, @tags, @description, @isbn, @asin, @started_reading, @finished_reading, @status, @format, @rating, @cover_url, @page_count, @publisher, @notes
        )
      `);

      const insertMany = db.transaction((books) => {
        for (const book of books) {
          insert.run({
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
        }
      });
      
      insertMany(booksToMigrate);
      console.log(`Migrated ${booksToMigrate.length} books successfully.`);
    }
    
    // Rename CSV to indicate migration complete (do outside if just to ensure it happens if empty too)
    fs.renameSync(csvPath, csvPath + '.bak');
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

// Convert SQLite row back to Book object
const mapRowToBook = (row: any): Book => {
  return {
    ...row,
    id: Number(row.id),
    rating: row.rating ? Number(row.rating) : undefined,
    page_count: row.page_count ? Number(row.page_count) : undefined,
  } as Book;
};

export const getBooks = (status?: string) => {
  if (status) {
    const rows = db.prepare('SELECT * FROM books WHERE status = ? ORDER BY id DESC').all(status);
    return rows.map(mapRowToBook);
  } else {
    const rows = db.prepare('SELECT * FROM books ORDER BY id DESC').all();
    return rows.map(mapRowToBook);
  }
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
  cachedTags = null;
  return Number(result.lastInsertRowid);
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
      addedBooks.push({ ...book, id: Number(result.lastInsertRowid) } as Book);
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
  values.push(id); // push the id for WHERE clause
  
  const stmt = db.prepare(`UPDATE books SET ${setClause} WHERE id = ?`);
  const result = stmt.run(...values);
  
  if (result.changes > 0) {
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

  const rows = db.prepare('SELECT tags FROM books WHERE tags IS NOT NULL AND tags != ""').all() as { tags: string }[];
  const tags = new Set<string>();
  
  rows.forEach(row => {
    row.tags.split(',').forEach(tag => {
      const trimmed = tag.trim();
      if (trimmed) tags.add(trimmed);
    });
  });
  
  cachedTags = Array.from(tags).sort();
  lastTagReadTime = now;
  return cachedTags;
};

export default { getBooks, getBookById, addBook, addBooks, updateBook, updateBooks, deleteBook, deleteBooks, getTags, exportDbToCsv };
