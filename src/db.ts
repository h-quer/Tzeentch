import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { Book } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../data/library.csv');

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

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize CSV file if it doesn't exist
if (!fs.existsSync(dbPath)) {
  const initialData = Papa.unparse({
    fields: Object.values(HEADER_MAP),
    data: []
  });
  fs.writeFileSync(dbPath, initialData);
}

const readDb = (): Book[] => {
  try {
    const csvData = fs.readFileSync(dbPath, 'utf8');
    const result = Papa.parse(csvData, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true
    });
    
    return (result.data as any[]).map(row => {
      const book: any = {};
      for (const [csvHeader, value] of Object.entries(row)) {
        const internalKey = REVERSE_HEADER_MAP[csvHeader];
        if (internalKey) {
          book[internalKey] = value;
        }
      }
      return {
        ...book,
        id: Number(book.id),
        rating: book.rating ? Number(book.rating) : undefined,
        page_count: book.page_count ? Number(book.page_count) : undefined,
      };
    }) as Book[];
  } catch (error) {
    console.error('Error reading database:', error);
    return [];
  }
};

const writeDb = (books: Book[]) => {
  try {
    const mappedBooks = books.map(book => {
      const row: any = {};
      for (const [internalKey, csvHeader] of Object.entries(HEADER_MAP)) {
        row[csvHeader] = (book as any)[internalKey];
      }
      return row;
    });
    const csv = Papa.unparse({
      fields: Object.values(HEADER_MAP),
      data: mappedBooks
    });
    fs.writeFileSync(dbPath, csv);
  } catch (error) {
    console.error('Error writing database:', error);
  }
};

export const getBooks = (status?: string) => {
  const books = readDb();
  if (status) {
    return books.filter(book => book.status === status).sort((a, b) => b.id - a.id);
  }
  return books.sort((a, b) => b.id - a.id);
};

export const getBookById = (id: number) => {
  const books = readDb();
  return books.find(book => book.id === id);
};

export const addBook = (book: Omit<Book, 'id'>) => {
  const books = readDb();
  const nextId = books.length > 0 ? Math.max(...books.map(b => b.id || 0)) + 1 : 1;
  const newBook = { ...book, id: nextId } as Book;
  books.push(newBook);
  writeDb(books);
  cachedTags = null;
  return nextId;
};

export const addBooks = (newBooks: Omit<Book, 'id'>[]) => {
  const books = readDb();
  let nextId = books.length > 0 ? Math.max(...books.map(b => b.id || 0)) + 1 : 1;
  const addedBooks: Book[] = [];
  
  for (const book of newBooks) {
    const newBook = { ...book, id: nextId } as Book;
    books.push(newBook);
    addedBooks.push(newBook);
    nextId++;
  }
  
  writeDb(books);
  cachedTags = null;
  return addedBooks;
};

export const updateBook = (id: number, updates: Partial<Book>) => {
  const books = readDb();
  const index = books.findIndex(book => book.id === id);
  if (index !== -1) {
    books[index] = { ...books[index], ...updates };
    writeDb(books);
    cachedTags = null;
    return true;
  }
  return false;
};

export const updateBooks = (ids: number[], updates: Partial<Book>) => {
  const books = readDb();
  let updatedCount = 0;
  
  for (const id of ids) {
    const index = books.findIndex(book => book.id === id);
    if (index !== -1) {
      books[index] = { ...books[index], ...updates };
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    writeDb(books);
    cachedTags = null;
    return true;
  }
  return false;
};

export const deleteBook = (id: number) => {
  const books = readDb();
  const filteredBooks = books.filter(book => book.id !== id);
  if (filteredBooks.length !== books.length) {
    writeDb(filteredBooks);
    cachedTags = null;
    return true;
  }
  return false;
};

export const deleteBooks = (ids: number[]) => {
  const books = readDb();
  const filteredBooks = books.filter(book => !ids.includes(book.id));
  if (filteredBooks.length !== books.length) {
    writeDb(filteredBooks);
    cachedTags = null;
    return true;
  }
  return false;
};

let cachedTags: string[] | null = null;
let lastTagReadTime = 0;
const TAG_CACHE_TTL = 30000; // 30 seconds

export const getTags = () => {
  const now = Date.now();
  if (cachedTags && (now - lastTagReadTime < TAG_CACHE_TTL)) {
    return cachedTags;
  }

  const books = readDb();
  const tags = new Set<string>();
  books.forEach(book => {
    if (book.tags) {
      book.tags.split(',').forEach(tag => {
        const trimmed = tag.trim();
        if (trimmed) tags.add(trimmed);
      });
    }
  });
  
  cachedTags = Array.from(tags).sort();
  lastTagReadTime = now;
  return cachedTags;
};

export default { getBooks, getBookById, addBook, addBooks, updateBook, updateBooks, deleteBook, deleteBooks, getTags };
