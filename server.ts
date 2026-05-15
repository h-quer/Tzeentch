import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import Papa from 'papaparse';
import fs from 'fs';
import os from 'os';
import { getBooks, globalSearch, addBook, addBooks, updateBook, updateBooks, bulkSyncBooks, deleteBook, deleteBooks, getBookById, getTags, exportDbToCsv, getStats } from './src/db.js';
import { Book, SearchResult, BookStatus } from './src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ dest: os.tmpdir() });

const coversDir = path.resolve(__dirname, 'data/covers');
const customCssPath = path.resolve(__dirname, 'data/custom.css');

if (!fs.existsSync(coversDir)) {
  fs.mkdirSync(coversDir, { recursive: true });
}

if (!fs.existsSync(customCssPath)) {
  const defaultCustomCss = `/* 
  Tzeentch Custom CSS
  Use this file to override the default theme.
  Changes here are persistent and will survive container restarts.
  
  Example Overrides (uncomment to use):
  
  :root {
    /* Colors */
    /* --color-tzeentch-bg: #050b18; */
    /* --color-tzeentch-card: #0f172a; */
    /* --color-tzeentch-cyan: #22d3ee; */
    /* --color-tzeentch-magenta: #d946ef; */
    /* --color-tzeentch-gold: #fbbf24; */
    /* --color-tzeentch-warp: #1e1b4b; */
    
    /* Typography */
    /* --font-display: "Space Grotesk", sans-serif; */
  }

  /* You can also add any other standard CSS here */
  /* body { font-family: sans-serif; } */
*/
`;
  fs.writeFileSync(customCssPath, defaultCustomCss);
}

async function downloadImage(url: string, dest: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
}

// --- Google Books API Helpers ---
const searchCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Periodic cleanup of searchCache
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}, 1000 * 60 * 15); // Every 15 minutes

let googleRequestQueue: Promise<any> = Promise.resolve();
const MIN_GAP = 3000; // 3 seconds gap between requests (conservative for unauthenticated)

async function googleBooksFetch(url: string, signal?: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    googleRequestQueue = googleRequestQueue.then(async () => {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      
      try {
        const response = await fetch(url, {
          signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://books.google.com/'
          }
        });
        
        // Always wait MIN_GAP before letting next request through
        await new Promise(r => setTimeout(r, MIN_GAP));
        return response;
      } catch (e: any) {
        if (e.name === 'AbortError' || e.message === 'Aborted') {
          throw e;
        }
        console.error(`[Google Books] Fetch error:`, e);
        // Wait even on error to protect the queue
        await new Promise(r => setTimeout(r, MIN_GAP));
        throw e;
      }
    }).then(resolve).catch((err) => {
      if (err.name === 'AbortError' || err.message === 'Aborted') {
        reject(err);
      } else {
        // Return a 500 response if it failed
        console.error(`[Google Books] Request failed:`, err);
        resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
      }
    });
  });
}
// --------------------------------

function splitSeries(seriesStr?: string) {
  if (!seriesStr) return { series: undefined, series_number: undefined };
  
  const hashIndex = seriesStr.lastIndexOf('#');
  if (hashIndex !== -1) {
    const name = seriesStr.substring(0, hashIndex).trim().replace(/,$/, '');
    const number = seriesStr.substring(hashIndex + 1).trim();
    return { series: name, series_number: number };
  }
  
  return { series: seriesStr, series_number: undefined };
}

function parseGoodreadsTitle(title: string) {
  // Regex to match "Title (Series Name, #Number)" or "Title (Series Name #Number)" at the end of the string
  // Handles decimal numbers and ranges (e.g., #1.5, #1-2)
  const seriesRegex = /^(.*)\s\((.*?)(?:,\s|\s)#([\d\.-]+)\)$/;
  const match = title.match(seriesRegex);
  
  if (match) {
    return {
      title: match[1].trim(),
      series: match[2].trim(),
      series_number: match[3]
    };
  }
  
  return { title, series: undefined, series_number: undefined };
}

function stripHtml(html?: string): string | null {
  if (!html) return null;
  // Replace <br> and <p> with newlines, then strip other tags
  let text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<[^>]*>?/gm, '');
  // Decode common HTML entities
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
  return text.trim() || null;
}

async function fetchGoodreadsDetails(bookUrl: string) {
  if (!bookUrl) return null;
  const fullUrl = bookUrl.startsWith('http') ? bookUrl : `https://www.goodreads.com${bookUrl}`;
  
  try {
    const res = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    if (match) {
      const data = JSON.parse(match[1]);
      const apollo = data.props.pageProps.apolloState;
      for (const key in apollo) {
        if (key.startsWith('Book:')) {
          const bookData = apollo[key];
          const details = bookData.details;
          if (details) {
            let publishedDate = null;
            if (details.publicationTime) {
              publishedDate = new Date(details.publicationTime).toISOString().split('T')[0];
            }
            
            const categories = bookData.bookGenres 
              ? bookData.bookGenres.map((g: any) => g.genre.name).join(', ') 
              : null;

            return {
              isbn: details.isbn13 || details.isbn || null,
              asin: details.asin || null,
              pageCount: details.numPages || null,
              publisher: details.publisher || null,
              publishedDate,
              description: stripHtml(bookData.description) || null,
              categories
            };
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch Goodreads details:', e);
  }
  return null;
}

function getSurname(author: string): string {
  const parts = author.trim().split(/\s+/);
  if (parts.length > 1) {
    return parts[parts.length - 1];
  }
  return author;
}

async function fetchCoverUrl(title: string, author: string, isbn?: string, goodreadsBookId?: string): Promise<string | undefined> {
  try {
    if (goodreadsBookId) {
      try {
        const res = await fetch(`https://www.goodreads.com/book/show/${goodreadsBookId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          }
        });
        const html = await res.text();
        const match = html.match(/<meta property="og:image" content="([^"]+)"/);
        if (match && match[1] && !match[1].includes('nophoto')) {
          return match[1];
        }
      } catch (e) {
        console.error(`Failed to fetch cover from Goodreads for book ${goodreadsBookId}:`, e);
      }
      // If a Goodreads ID was provided, we strictly only query Goodreads.
      return undefined;
    }

    let query = '';
    if (isbn) {
      query = `isbn:${isbn.replace(/\D/g, '')}`;
    } else {
      const cleanTitle = title.replace(/\s*\(.*?\)\s*$/, '').trim();
      query = `intitle:"${cleanTitle}" inauthor:"${author}"`;
    }
    
    console.log(`[Google Books] Fetching cover with URL: https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`);
    let res = await googleBooksFetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`);
    
      if (!res.ok) {
        if (res.status === 429) {
          console.warn(`[Google Books] Rate limited (429) during cover fetch.`);
        } else {
          console.error(`[Google Books] Cover fetch API error (${res.status})`);
        }
        return undefined;
      }

    let data = await res.json();
    
    // Retry with broader search if no results and not searching by ISBN
    if ((!data.items || data.items.length === 0) && !isbn) {
      const surname = getSurname(author);
      if (surname !== author && author !== 'Unknown Author') {
        const cleanTitle = title.replace(/\s*\(.*?\)\s*$/, '').trim();
        query = `intitle:"${cleanTitle}" inauthor:"${surname}"`;
        console.log(`[Google Books] Retrying cover fetch with broader query: ${query}`);
        res = await googleBooksFetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`);
        if (res.ok) data = await res.json();
      }
      
      // Final fallback: just title and author keywords
      if (!data.items || data.items.length === 0) {
        const cleanTitle = title.replace(/\s*\(.*?\)\s*$/, '').trim();
        query = `${cleanTitle} ${author === 'Unknown Author' ? '' : author}`;
        console.log(`[Google Books] Final fallback cover fetch query: ${query}`);
        res = await googleBooksFetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query.trim())}&maxResults=1`);
        if (res.ok) data = await res.json();
      }
    }

    if (data.items && data.items.length > 0) {
      const volumeInfo = data.items[0].volumeInfo;
      let coverUrl = volumeInfo.imageLinks?.extraLarge || 
                     volumeInfo.imageLinks?.large || 
                     volumeInfo.imageLinks?.medium || 
                     volumeInfo.imageLinks?.thumbnail;
      
      if (coverUrl) {
        coverUrl = coverUrl.replace('http:', 'https:');
        return coverUrl.replace('&zoom=1', '&zoom=3');
      }
    }
  } catch (error) {
    console.error('Failed to fetch cover URL:', error);
  }
  return undefined;
}

async function performMetadataRefresh(bookId: number, userProvider?: string, specificSourceUrl?: string): Promise<{ success: boolean, error?: string }> {
  const book = getBookById(bookId);
  if (!book) return { success: false, error: `Book ${bookId} not found` };

  let provider = userProvider;
  const sourceUrl = specificSourceUrl || book.metadata_source || '';

  if (!provider) {
    const source = sourceUrl.toLowerCase();
    if (source.includes('google')) provider = 'google';
    else if (source.includes('audible')) provider = 'audible';
    else if (source.includes('goodreads')) provider = 'goodreads';
    else provider = 'google'; // Fallback
  }

  try {
    let metadata: Partial<Book> | null = null;
    
    if (provider === 'google') {
      let googleId = null;
      if (sourceUrl.includes('id=')) {
        const match = sourceUrl.match(/[?&]id=([^&]+)/);
        if (match) googleId = match[1];
      } else if (sourceUrl.includes('books/v1/volumes/')) {
        const parts = sourceUrl.split('volumes/');
        if (parts.length > 1) googleId = parts[1].split('?')[0];
      }

      let url = '';
      if (googleId) {
        url = `https://www.googleapis.com/books/v1/volumes/${googleId}`;
      } else {
        let query = '';
        if (book.isbn) {
          query = `isbn:${book.isbn.replace(/\D/g, '')}`;
        } else {
          // Clean title: remove series info in parentheses
          const cleanTitle = book.title.replace(/\s*\(.*?\)\s*$/, '').trim();
          query = `intitle:"${cleanTitle}" inauthor:"${book.author}"`;
        }
        url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`;
      }
      
      console.log(`[Google Books] Refreshing metadata with URL: ${url}`);
      let response = await googleBooksFetch(url);
      
      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[Google Books] Rate limited (429) during metadata refresh.`);
          return { success: false, error: 'Rate limited by Google Books API. Please try again later.' };
        }
        const errorText = await response.text();
        console.error(`[Google Books] Metadata API error (${response.status}): ${errorText}`);
        return { success: false, error: `Google Books API returned ${response.status}` };
      }

      let data = await response.json();
      
      let item = data;
      if (data.items && data.items.length > 0) {
        item = data.items[0];
      }

      // Retry with broader search if no results and not searching by ISBN/ID
      if (!googleId && (!data.items || data.items.length === 0) && !book.isbn) {
        const surname = getSurname(book.author);
        if (surname !== book.author && book.author !== 'Unknown Author') {
          const cleanTitle = book.title.replace(/\s*\(.*?\)\s*$/, '').trim();
          let query = `intitle:"${cleanTitle}" inauthor:"${surname}"`;
          console.log(`[Google Books] Retrying with broader query: ${query}`);
          response = await googleBooksFetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`);
          if (response.ok) {
            data = await response.json();
            if (data.items && data.items.length > 0) {
              item = data.items[0];
            }
          }
        }
      }  
        // Final fallback: just title and author keywords
        if (!item.volumeInfo && (!data.items || data.items.length === 0)) {
          const cleanTitle = book.title.replace(/\s*\(.*?\)\s*$/, '').trim();
          let query = `${cleanTitle} ${book.author === 'Unknown Author' ? '' : book.author}`;
          console.log(`[Google Books] Final fallback query: ${query}`);
          response = await googleBooksFetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query.trim())}&maxResults=1`);
          if (response.ok) {
            data = await response.json();
            if (data.items && data.items.length > 0) {
              item = data.items[0];
            }
          }
        }

      if (item.volumeInfo) {
        const info = item.volumeInfo;
        const identifiers = info.industryIdentifiers || [];
        const isbn13 = identifiers.find((id: any) => id.type === 'ISBN_13')?.identifier;
        const isbn10 = identifiers.find((id: any) => id.type === 'ISBN_10')?.identifier;
        
        let coverUrl = info.imageLinks?.extraLarge || info.imageLinks?.large || info.imageLinks?.medium || info.imageLinks?.thumbnail;
        if (coverUrl) {
          coverUrl = coverUrl.replace('http:', 'https:');
          if (coverUrl.includes('zoom=1')) {
            coverUrl = coverUrl.replace('&zoom=1', '&zoom=3');
          }
        }

        metadata = {
          title: info.title,
          author: info.authors?.join(', ') || 'Unknown Author',
          description: stripHtml(info.description),
          published_date: info.publishedDate,
          page_count: info.pageCount,
          publisher: info.publisher,
          isbn: isbn13 || isbn10 || null,
          asin: (isbn13 || isbn10) ? null : undefined,
          cover_url: coverUrl,
          metadata_source: info.infoLink,
          tags: info.categories?.join(', ') || null
        };
      }
    } else if (provider === 'audible') {
      let asin = null;
      if (sourceUrl.includes('/pd/')) {
        const match = sourceUrl.match(/\/pd\/([A-Z0-9]{10})/);
        if (match) asin = match[1];
      } else if (sourceUrl.includes('asin=')) {
        const match = sourceUrl.match(/[?&]asin=([A-Z0-9]{10})/);
        if (match) asin = match[1];
      }

      let query = `${book.title} ${book.author}`;
      if (asin) query = asin;
      else if (book.asin) query = book.asin;
      
      let response = await fetch(`https://api.audible.com/1.0/catalog/products?keywords=${encodeURIComponent(query)}&response_groups=product_attrs,product_desc,contributors,media,series,category_ladders&num_results=1`);
      if (!response.ok) {
        console.error(`[Audible] API error (${response.status})`);
        return { success: false, error: `Audible API returned ${response.status}` };
      }
      let data = await response.json();
      
      if ((!data.products || data.products.length === 0) && !asin && !book.asin) {
        const surname = getSurname(book.author);
        if (surname !== book.author) {
          query = `${book.title} ${surname}`;
          response = await fetch(`https://api.audible.com/1.0/catalog/products?keywords=${encodeURIComponent(query)}&response_groups=product_attrs,product_desc,contributors,media,series,category_ladders&num_results=1`);
          if (response.ok) {
            data = await response.json();
          }
        }
      }

      if (data.products && data.products.length > 0) {
        const product = data.products[0];
        const author = product.authors?.map((a: any) => a.name).join(', ') || 'Unknown Author';
        const narrator = product.narrators?.map((n: any) => n.name).join(', ');
        
        let coverUrl = product.product_images?.['500'] || product.product_images?.['large'];
        if (product.media?.images) {
          coverUrl = product.media.images['500'] || product.media.images['large'] || coverUrl;
        }

        const seriesInfo = product.series?.[0];

        let categoriesStr = null;
        if (product.category_ladders && product.category_ladders.length > 0) {
          const uniqueCategories = new Set<string>();
          product.category_ladders.forEach((ladder: any) => {
            ladder.ladder?.forEach((cat: any) => uniqueCategories.add(cat.name));
          });
          categoriesStr = Array.from(uniqueCategories).join(', ');
        }
        
        metadata = {
          title: product.title,
          author: author,
          narrator: narrator,
          description: stripHtml(product.extended_description || product.publisher_summary || product.merchandising_summary || product.product_desc),
          published_date: product.release_date,
          publisher: product.publisher_name,
          asin: product.asin || null,
          isbn: product.asin ? null : undefined,
          cover_url: coverUrl,
          metadata_source: `https://www.audible.com/pd/${product.asin}`,
          series: seriesInfo?.title,
          series_number: seriesInfo?.sequence,
          tags: categoriesStr,
          page_count: product.runtime_length_min
        };
      }
    } else if (provider === 'goodreads') {
      let query = `${book.title} ${book.author}`;
      let response = await fetch(`https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        console.error(`[Goodreads] API error (${response.status})`);
        return { success: false, error: `Goodreads API returned ${response.status}` };
      }
      let data = await response.json();
      
      if (!data || data.length === 0) {
        const surname = getSurname(book.author);
        if (surname !== book.author) {
          query = `${book.title} ${surname}`;
          response = await fetch(`https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(query)}`);
          if (response.ok) {
            data = await response.json();
          }
        }
      }

      if (data && data.length > 0) {
        const item = data[0];
        let coverUrl = item.imageUrl;
        if (coverUrl) {
          coverUrl = coverUrl.replace(/_S[Y|X]\d+_/, '_SY600_');
        }
        
        const { title: cleanTitle, series: parsedSeries, series_number: parsedSeriesNumber } = parseGoodreadsTitle(item.title);

        metadata = {
          title: cleanTitle,
          author: item.author.name,
          cover_url: coverUrl,
          description: stripHtml(item.description?.html),
          metadata_source: `https://www.goodreads.com${item.bookUrl}`,
          series: parsedSeries || (item.seriesName ? splitSeries(item.seriesName).series : null),
          series_number: parsedSeriesNumber || (item.seriesName ? splitSeries(item.seriesName).series_number : null),
          tags: null,
          page_count: item.numPages || null
        };

        // Fetch extra details from the book page
        const details = await fetchGoodreadsDetails(item.bookUrl);
        if (details) {
          metadata = {
            ...metadata,
            isbn: details.isbn || null,
            asin: details.asin || null,
            page_count: details.pageCount || metadata.page_count,
            publisher: details.publisher || null,
            published_date: details.publishedDate || null,
            description: details.description || metadata.description,
            tags: details.categories || null
          };
        }
      }
    }

    if (metadata) {
      const updatedData: Partial<Book> = {
        ...metadata,
        started_reading: book.started_reading,
        finished_reading: book.finished_reading,
        status: book.status,
        format: provider === 'audible' ? 'Audiobook' : book.format,
        rating: book.rating,
        notes: book.notes,
      };

      const oldCoverUrl = book.cover_url;
      const newCoverUrl = metadata.cover_url;

      if (newCoverUrl && newCoverUrl.startsWith('http')) {
        try {
          const ext = '.jpg';
          const fileName = `cover_${book.id}_${Date.now()}${ext}`;
          const filePath = path.join(coversDir, fileName);
          const relativePath = `/covers/${fileName}`;

          await downloadImage(newCoverUrl, filePath);
          
          // Image downloaded successfully, safe to delete the old one
          if (oldCoverUrl && oldCoverUrl.startsWith('/covers/')) {
            const oldPath = path.join(__dirname, 'data', oldCoverUrl);
            if (fs.existsSync(oldPath)) {
              try { fs.unlinkSync(oldPath); } catch (e) {}
            }
          }

          updatedData.cover_url = relativePath;
        } catch (e) {
          console.error(`Failed to download cover for book ${book.id}:`, e);
          updatedData.cover_url = oldCoverUrl;
        }
      } else if (!newCoverUrl) {
        if (oldCoverUrl && oldCoverUrl.startsWith('/covers/')) {
          const oldPath = path.join(__dirname, 'data', oldCoverUrl);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
          }
        }
        updatedData.cover_url = null;
      }

      updateBook(book.id, updatedData);
      return { success: true };
    } else {
      return { success: false, error: `No metadata found for ${book.title} via ${provider}` };
    }
  } catch (error) {
    console.error(`Refresh error for book ${book.id}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use('/covers', express.static(coversDir));
  app.get('/custom.css', (req, res) => {
    res.sendFile(customCssPath);
  });

  const uiConfigPath = path.resolve(__dirname, 'data/ui-config.json');
  const defaultUiConfig = {
    viewPreferences: {
      Reading: 'cards',
      Read: 'list',
      Backlog: 'list',
      Wishlist: 'cards',
      Dropped: 'show-with-read'
    },
    listColumns: ['title', 'author', 'narrator', 'series', 'format', 'started_reading', 'finished_reading'],
    cardFields: ['title', 'author', 'narrator', 'series', 'started_reading', 'finished_reading'],
    sortFields: [
      { id: 'finished_reading', direction: 'desc' },
      { id: 'started_reading', direction: 'desc' },
      { id: 'author', direction: 'asc' }
    ],
    theme: 'system'
  };

  app.get('/api/ui-config', (req, res) => {
    try {
      let config: any = { ...defaultUiConfig };
      if (fs.existsSync(uiConfigPath)) {
        const data = fs.readFileSync(uiConfigPath, 'utf-8');
        config = { ...config, ...JSON.parse(data) };
      }
      config.absIntegrationEnabled = process.env.ABS_INTEGRATION === 'True';
      res.json(config);
    } catch (error) {
      console.error('Error reading UI config:', error);
      const config: any = { ...defaultUiConfig, absIntegrationEnabled: process.env.ABS_INTEGRATION === 'True' };
      res.json(config);
    }
  });

  let lastActiveTab: string = 'Overview';

  app.get('/api/last-active-tab', (req, res) => {
    res.json({ lastActiveTab });
  });

  app.post('/api/last-active-tab', (req, res) => {
    const { tab } = req.body;
    if (tab) {
      lastActiveTab = tab;
    }
    res.json({ success: true });
  });

  app.post('/api/ui-config', (req, res) => {
    try {
      fs.writeFileSync(uiConfigPath, JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving UI config:', error);
      res.status(500).json({ error: 'Failed to save UI config' });
    }
  });

  app.post('/api/abs-sync', async (req, res) => {
    try {
      const { absUrl, absApiKey, absLibrary, syncMode, fromDate, overwriteMode, timezoneOffset } = req.body;
      const offset = timezoneOffset || 0;
      
      if (!absUrl || !absApiKey) {
        return res.status(400).json({ error: 'Audiobookshelf URL and API Key are required' });
      }

      const baseUrl = absUrl.replace(/\/$/, '');

      const formatDate = (ts: number | string | undefined) => {
        if (!ts) return '';
        const timestamp = typeof ts === 'string' ? new Date(ts).getTime() : ts;
        const d = new Date(timestamp - (offset * 60000));
        return d.toISOString().split('T')[0];
      };
      
      const toMs = (val: any) => {
        if (!val) return 0;
        if (typeof val === 'number') return val < 100000000000 ? val * 1000 : val;
        const t = new Date(val).getTime();
        return isNaN(t) ? 0 : t;
      };

      // Fetch libraries
      const librariesRes = await fetch(`${baseUrl}/api/libraries`, {
        headers: { 'Authorization': `Bearer ${absApiKey}` }
      });
      
      if (!librariesRes.ok) {
        throw new Error(`Failed to connect to Audiobookshelf: ${librariesRes.statusText}`);
      }
      
      const libData: any = await librariesRes.json();
      const libraries = libData.libraries || [];
      
      let allItems: any[] = [];
      for (const library of libraries) {
        if (library.mediaType === 'book') {
          if (absLibrary && (library.name || '').toString().toLowerCase() !== absLibrary.toLowerCase()) {
            continue;
          }
          
          const itemsRes = await fetch(`${baseUrl}/api/libraries/${library.id}/items?include=progress`, {
            headers: { 'Authorization': `Bearer ${absApiKey}` }
          });
          
          if (itemsRes.ok) {
            const itemsData: any = await itemsRes.json();
            const items = itemsData.results || [];
            allItems = allItems.concat(items);
          }
        }
      }

      // Fetch user progress global map
      const progressMap = new Map<string, any>();
      let recentProgressIds = new Set<string>();
      try {
        const meRes = await fetch(`${baseUrl}/api/me`, {
          headers: { 'Authorization': `Bearer ${absApiKey}` }
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          const mediaProgress = meData.user?.mediaProgress || meData.mediaProgress || [];
          
          const fromTimestamp = (syncMode === 'from' && fromDate) ? new Date(fromDate).getTime() + (offset * 60000) : 0;

          mediaProgress.forEach((p: any) => {
            if (p.libraryItemId) {
              const idStr = String(p.libraryItemId);
              progressMap.set(idStr, p);

              if (fromTimestamp) {
                const progressTime = Math.max(toMs(p.updatedAt), toMs(p.lastUpdate), toMs(p.startedAt), toMs(p.finishedAt));
                if (progressTime >= fromTimestamp) {
                  recentProgressIds.add(idStr);
                }
              }
            }
          });
        }
      } catch (err) {
        console.error('Failed to fetch user progress from /api/me:', err);
      }

      // Filter by date
      if (syncMode === 'from' && fromDate) {
        const fromTimestamp = new Date(fromDate).getTime() + (offset * 60000);
        allItems = allItems.filter(item => {
          const progress = progressMap.get(String(item.id)) || item.userProgress || item.progress || {};
          const timestamps = [
            toMs(item.updatedAt),
            toMs(item.addedAt),
            toMs(item.lastUpdate),
            toMs(progress.updatedAt),
            toMs(progress.startedAt),
            toMs(progress.finishedAt),
            toMs(item.media?.metadata?.updatedAt)
          ];
          const latestUpdate = Math.max(...timestamps);
          return latestUpdate >= fromTimestamp || recentProgressIds.has(String(item.id));
        });
      }

      // 1. Pre-fetch all books for O(1) lookup
      const existingBooksResult = getBooks();
      const bookLookup = new Map<string, Book>();
      existingBooksResult.forEach(b => {
        const key = `${(b.title || '').toLowerCase()}|${(b.author || '').toLowerCase()}`;
        bookLookup.set(key, b);
      });

      const toAdd: Omit<Book, 'id'>[] = [];
      const toUpdate: {id: number, updates: Partial<Book>}[] = [];

      for (const item of allItems) {
        const metadata = item.media?.metadata || {};
        const progress = progressMap.get(String(item.id)) || item.userProgress || item.progress || {};
        const title = metadata.title || 'Unknown Title';
        const author = metadata.authorName || (metadata.authors ? metadata.authors.map((a: any) => a.name).join(', ') : 'Unknown Author');
        const lookupKey = `${title.toLowerCase()}|${author.toLowerCase()}`;
        const existingBook = bookLookup.get(lookupKey);

        const narrator = metadata.narratorName || (metadata.narrators ? metadata.narrators.map((n: any) => n.name).join(', ') : '');
        let series = '';
        let series_number: string | number = '';
        if (metadata.series && metadata.series.length > 0) {
          series = metadata.series[0].name || '';
          series_number = metadata.series[0].sequence ?? '';
        } else if (metadata.seriesName) {
          series = metadata.seriesName;
          series_number = metadata.seriesSequence ?? '';
        }

        if (series) {
          const seriesMatch = series.match(/^(.*?)\s*#(\d+(?:\.\d+)?)$/);
          if (seriesMatch) {
            series = seriesMatch[1].trim();
            if (series_number === '') series_number = seriesMatch[2];
          }
        }

        const published_date = metadata.publishedYear ? metadata.publishedYear.toString() : '';
        const description = metadata.description || '';
        const isbn = metadata.isbn || '';
        const asin = metadata.asin || '';
        const publisher = metadata.publisher || '';
        
        let tagsArr = item.media?.tags || [];
        if (typeof tagsArr === 'string') tagsArr = tagsArr.split(',');
        const tags = (Array.isArray(tagsArr) ? tagsArr : [])
          .map((t: any) => String(t).trim().replace(/,/g, ''))
          .filter((t: string, i: number, self: string[]) => t && self.indexOf(t) === i)
          .join(', ');
        
        const page_count = metadata.numPages ? Number(metadata.numPages) : undefined;
        let started_reading = progress.startedAt ? formatDate(progress.startedAt) : '';
        let finished_reading = progress.finishedAt ? formatDate(progress.finishedAt) : (progress.isFinished ? formatDate(Date.now()) : '');

        let status: BookStatus = 'Backlog';
        if (started_reading && !finished_reading) status = 'Reading';
        else if (finished_reading) status = 'Read';

        let cover_url = '';
        if (item.id && baseUrl && absApiKey) {
           const coverUrl = `${baseUrl}/api/items/${item.id}/cover`;
           const filename = `abs_${item.id}.jpg`;
           const filePath = path.join(coversDir, filename);
           // NOTE: Cover download is still async and sequential for now to avoid hammering the server, 
           // but we only do it if the file doesn't exist or we really need to.
           if (!fs.existsSync(filePath)) {
             try {
               await downloadImage(coverUrl, filePath, { 'Authorization': `Bearer ${absApiKey}` });
               cover_url = `/covers/${filename}`;
             } catch (err) {
               console.error(`Failed to download cover for ${item.id}:`, err);
             }
           } else {
             cover_url = `/covers/${filename}`;
           }
        }

        const bookData: Partial<Book> = {
          title, author, narrator, series,
          series_number: (series_number !== '' && series_number !== undefined) ? series_number.toString() : '',
          published_date, description, isbn, asin, publisher, tags, page_count,
          started_reading, finished_reading, status,
          format: 'Audiobook', metadata_source: 'Audiobookshelf'
        };
        if (cover_url) bookData.cover_url = cover_url;

        if (existingBook) {
          let updates = { ...bookData };
          if (overwriteMode === 'empty-only') {
            for (const key of Object.keys(updates) as Array<keyof Book>) {
              if (existingBook[key] !== undefined && existingBook[key] !== null && existingBook[key] !== '') {
                delete (updates as any)[key];
              }
            }
            if (updates.finished_reading) updates.status = 'Read';
            else if (updates.started_reading && existingBook.status === 'Backlog') updates.status = 'Reading';
          } else if (overwriteMode === 'dates-empty-only') {
            if (existingBook.started_reading) delete updates.started_reading;
            if (existingBook.finished_reading) delete updates.finished_reading;
            if (updates.finished_reading) updates.status = 'Read';
            else if (updates.started_reading && !existingBook.finished_reading) updates.status = 'Reading';
            else delete updates.status;
          }

          if (Object.keys(updates).length > 0) {
            toUpdate.push({ id: existingBook.id, updates });
          }
        } else {
          toAdd.push(bookData as Omit<Book, 'id'>);
        }
      }

      // 4. Perform everything in a single transaction
      const syncResult = bulkSyncBooks(toAdd, toUpdate);

      res.json({ success: true, added: syncResult.added, updated: syncResult.updated });
    } catch (error: any) {
      console.error('Error syncing with ABS:', error);
      res.status(500).json({ error: error.message || 'Failed to sync with Audiobookshelf' });
    }
  });

  // API Routes
  app.get('/api/books', (req, res) => {
    try {
      const status = req.query.status as string;
      const tag = req.query.tag as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const sortFields = req.query.sort ? JSON.parse(req.query.sort as string) : undefined;
      
      const statuses: string[] = [];
      if (status && status !== 'Overview') {
        statuses.push(status);
        if (status === 'Read' && req.query.includeDropped === 'true') {
          statuses.push('Dropped');
        }
      }

      const books = getBooks({
        statuses: statuses.length > 0 ? statuses : undefined,
        tag,
        sortFields,
        limit,
        offset
      });
      res.json(books);
    } catch (error) {
      console.error('Error fetching books:', error);
      res.status(500).json({ error: 'Failed to fetch books' });
    }
  });

  app.get('/api/tags', (req, res) => {
    const tags = getTags();
    res.json(tags);
  });

  app.get('/api/stats', (req, res) => {
    try {
      const stats = getStats();
      res.json(stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  app.post('/api/books', async (req, res) => {
    try {
      const book: Book = req.body;
      const id = addBook(book);
      
      if (book.cover_url && book.cover_url.startsWith('http')) {
        try {
          const url = new URL(book.cover_url);
          const ext = path.extname(url.pathname) || '.jpg';
          const fileName = `cover_${id}_${Date.now()}${ext}`;
          const filePath = path.join(coversDir, fileName);
          await downloadImage(book.cover_url, filePath);
          
          updateBook(id, { cover_url: `/covers/${fileName}` });
        } catch (error) {
          console.error('Failed to download cover:', error);
        }
      }
      
      const updatedBook = getBookById(id);
      res.json(updatedBook);
    } catch (error: any) {
      console.error('Error adding book:', error);
      res.status(500).json({ error: error.message || 'Failed to add book' });
    }
  });

  app.patch('/api/books/:id', async (req, res) => {
    try {
      const { id } = req.params;
    const bookId = Number(id);
    const oldBook = getBookById(bookId);
    
    if (!oldBook) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const updates = { ...req.body };
    const isManualSelection = updates.isManualSelection;
    delete updates.isManualSelection;

    // Handle external cover URL update
    if (updates.cover_url && updates.cover_url.startsWith('http')) {
      try {
        const url = new URL(updates.cover_url);
        const ext = path.extname(url.pathname) || '.jpg';
        const fileName = `cover_${bookId}_${Date.now()}${ext}`;
        const filePath = path.join(coversDir, fileName);
        const relativePath = `/covers/${fileName}`;

        await downloadImage(updates.cover_url, filePath);

        // Delete old cover if it was local, ONLY after successful download
        if (oldBook.cover_url && oldBook.cover_url.startsWith('/covers/')) {
          const oldPath = path.join(__dirname, 'data', oldBook.cover_url);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
          }
        }

        updates.cover_url = relativePath;
      } catch (error) {
        console.error('Failed to download cover during patch:', error);
        // Keep old cover if download fails
        delete updates.cover_url;
      }
    }

    updateBook(bookId, updates);
    const updatedBook = getBookById(bookId);

    // Check if metadata_source was updated manually AND it's not a manual selection from a search
    // If it's a manual selection (like from ManualRefreshModal), we don't want to trigger a refresh
    // that might overwrite the user's manual selection.
    if (req.body.metadata_source && oldBook && req.body.metadata_source !== oldBook.metadata_source && !isManualSelection) {
      const source = req.body.metadata_source.toLowerCase();
      const isSupported = source.includes('goodreads.com') || source.includes('audible.com') || source.includes('google.com');
      
      if (isSupported) {
        try {
          const refreshResult = await performMetadataRefresh(bookId, undefined, req.body.metadata_source);
          if (refreshResult.success) {
            const refreshedBook = getBookById(bookId);
            return res.json({ success: true, book: refreshedBook, metadataRefreshed: true });
          } else {
            console.warn(`Auto-refresh metadata failed for book ${bookId}: ${refreshResult.error}`);
          }
        } catch (error) {
          console.error(`Failed to auto-refresh metadata for book ${bookId}:`, error);
        }
      }
    }

    res.json({ success: true, book: updatedBook });
    } catch (error: any) {
      console.error('Error updating book:', error);
      res.status(500).json({ error: error.message || 'Failed to update book' });
    }
  });

  app.patch('/api/books', (req, res) => {
    try {
      const { ids, updates } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: 'ids must be an array' });
      }
      updateBooks(ids, updates);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error bulk updating books:', error);
      res.status(500).json({ error: error.message || 'Failed to bulk update books' });
    }
  });

  app.delete('/api/books/:id', (req, res) => {
    try {
      const { id } = req.params;
      const bookId = Number(id);
      const book = getBookById(bookId);
      
      if (book && book.cover_url && book.cover_url.startsWith('/covers/')) {
        const coverPath = path.join(__dirname, 'data', book.cover_url);
        if (fs.existsSync(coverPath)) {
          try {
            fs.unlinkSync(coverPath);
          } catch (e) {
            console.error(`Failed to delete cover image for book ${bookId}:`, e);
          }
        }
      }
      
      deleteBook(bookId);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting book:', error);
      res.status(500).json({ error: error.message || 'Failed to delete book' });
    }
  });

  app.delete('/api/books', (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: 'ids must be an array' });
      }
      
      ids.forEach(id => {
        const bookId = Number(id);
        const book = getBookById(bookId);
        if (book && book.cover_url && book.cover_url.startsWith('/covers/')) {
          const coverPath = path.join(__dirname, 'data', book.cover_url);
          if (fs.existsSync(coverPath)) {
            try {
              fs.unlinkSync(coverPath);
            } catch (e) {
              console.error(`Failed to delete cover image for book ${bookId}:`, e);
            }
          }
        }
      });
      
      deleteBooks(ids);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error bulk deleting books:', error);
      res.status(500).json({ error: error.message || 'Failed to bulk delete books' });
    }
  });

  app.get('/api/export', (req, res) => {
    try {
      const csv = exportDbToCsv();
      res.header('Content-Type', 'text/csv');
      res.attachment('library_export.csv');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting database:', error);
      res.status(500).json({ error: 'Failed to export library' });
    }
  });

  app.post('/api/books/bulk-refresh-metadata', async (req, res) => {
    const { ids, provider: userProvider } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const id of ids) {
      const result = await performMetadataRefresh(Number(id), userProvider);
      if (result.success) {
        results.success++;
      } else {
        results.failed++;
        if (result.error) results.errors.push(result.error);
      }

      // Rate limiting: 1000ms delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.json({ success: true, results });
  });

  app.get('/api/metadata/enrich', async (req, res) => {
    const { source, url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });

    try {
      if (source === 'goodreads') {
        const details = await fetchGoodreadsDetails(url);
        return res.json(details || {});
      }
      res.status(400).json({ error: 'Unsupported source' });
    } catch (error) {
      console.error('Enrichment error:', error);
      res.status(500).json({ error: 'Failed to enrich metadata' });
    }
  });

  app.get('/api/search/global', (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q) {
        return res.json([]);
      }
      const results = globalSearch(q, 10);
      res.json(results);
    } catch (error) {
      console.error('Global search error:', error);
      res.status(500).json({ error: 'Failed to perform global search' });
    }
  });

  // Search API (Supports multiple sources)
  app.get('/api/search', async (req, res) => {
    const { q, source = 'google' } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });

    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
    });

    try {
      let results: SearchResult[] = [];

      if (source === 'google') {
        const cacheKey = `google:${q}`;
        const cached = searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          console.log(`[Google Books] Returning cached results for: ${q}`);
          return res.json(cached.data);
        }

        console.log(`[Google Books] Searching for: ${q}`);
        let response = await googleBooksFetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q as string)}&maxResults=20`, abortController.signal);
        
        if (!response.ok) {
          if (response.status === 429) {
            console.warn(`[Google Books] Rate limited (429) during search.`);
            return res.status(429).json({ error: 'Book search is temporarily rate-limited. Please wait a few minutes and try again.' });
          }
          const errorText = await response.text();
          console.error(`[Google Books] Search API error (${response.status}): ${errorText}`);
          return res.json([]);
        }

        const data = await response.json();
        
        results = (data.items || []).map((item: any) => {
          const info = item.volumeInfo;
          const identifiers = info.industryIdentifiers || [];
          const isbn13 = identifiers.find((id: any) => id.type === 'ISBN_13')?.identifier;
          const isbn10 = identifiers.find((id: any) => id.type === 'ISBN_10')?.identifier;
          
          // Get high quality cover if possible
          let coverUrl = info.imageLinks?.extraLarge || info.imageLinks?.large || info.imageLinks?.medium || info.imageLinks?.thumbnail;
          if (coverUrl) {
            coverUrl = coverUrl.replace('http:', 'https:');
            if (coverUrl.includes('zoom=1')) {
              coverUrl = coverUrl.replace('&zoom=1', '&zoom=3');
            }
          }
          
          return {
            title: info.title,
            author: info.authors?.join(', ') || 'Unknown Author',
            isbn: isbn13 || isbn10 || null,
            asin: null,
            cover_url: coverUrl,
            description: stripHtml(info.description),
            pageCount: info.pageCount,
            publishedDate: info.publishedDate,
            publisher: info.publisher,
            categories: info.categories?.join(', ') || null,
            metadata_source: info.infoLink,
            ...splitSeries(info.seriesInfo?.bookDisplayNumber ? `${info.title} #${info.seriesInfo.bookDisplayNumber}` : undefined)
          };
        });

        // Cache the results
        searchCache.set(cacheKey, { data: results, timestamp: Date.now() });
      } else if (source === 'audible') {
        const response = await fetch(`https://api.audible.com/1.0/catalog/products?keywords=${encodeURIComponent(q as string)}&response_groups=product_attrs,product_desc,contributors,media,series,category_ladders&num_results=10`, {
          signal: abortController.signal
        });
        
        if (!response.ok) {
          console.error(`[Audible] Search API error (${response.status})`);
          return res.status(response.status).json({ error: 'Audible search failed' });
        }
        
        const data = await response.json();
        
        results = (data.products || []).map((product: any) => {
          const authors = (product.authors || []).map((a: any) => a.name).join(', ');
          const narrators = (product.narrators || []).map((n: any) => n.name).join(', ');
          
          // Try to get high quality image
          let coverUrl = product.product_images?.['500'] || product.product_images?.['large'];
          if (product.media?.images) {
            coverUrl = product.media.images['500'] || product.media.images['large'] || coverUrl;
          }

          const seriesInfo = product.series && product.series.length > 0 
            ? `${product.series[0].title}${product.series[0].sequence ? ` #${product.series[0].sequence}` : ''}`
            : undefined;

          let categoriesStr = undefined;
          if (product.category_ladders && product.category_ladders.length > 0) {
            const uniqueCategories = new Set<string>();
            product.category_ladders.forEach((ladder: any) => {
              ladder.ladder?.forEach((cat: any) => uniqueCategories.add(cat.name));
            });
            categoriesStr = Array.from(uniqueCategories).join(', ');
          }
          
          return {
            title: product.title,
            author: authors || 'Unknown Author',
            narrator: narrators,
            asin: product.asin || null,
            isbn: null,
            cover_url: coverUrl,
            description: stripHtml(product.extended_description || product.publisher_summary || product.merchandising_summary || product.product_desc),
            publishedDate: product.release_date,
            publisher: product.publisher_name,
            ...splitSeries(seriesInfo),
            categories: categoriesStr || null,
            pageCount: product.runtime_length_min,
            metadata_source: `https://www.audible.com/pd/${product.asin}`
          };
        });
      } else if (source === 'goodreads') {
        const response = await fetch(`https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(q as string)}`, {
          signal: abortController.signal
        });
        
        if (!response.ok) {
          console.error(`[Goodreads] Search API error (${response.status})`);
          return res.status(response.status).json({ error: 'Goodreads search failed' });
        }
        
        const data = await response.json();
        
        const rawResults = data.map((item: any) => {
          let coverUrl = item.imageUrl;
          if (coverUrl) {
            // Try to get larger image
            coverUrl = coverUrl.replace(/_S[Y|X]\d+_/, '_SY600_');
          }
          
          const { title: cleanTitle, series: parsedSeries, series_number: parsedSeriesNumber } = parseGoodreadsTitle(item.title);
          
          return {
            title: cleanTitle,
            author: item.author.name,
            cover_url: coverUrl,
            description: stripHtml(item.description?.html),
            metadata_source: `https://www.goodreads.com${item.bookUrl}`,
            isbn: null,
            asin: null,
            categories: null,
            series: parsedSeries || (item.seriesName ? splitSeries(item.seriesName).series : null),
            series_number: parsedSeriesNumber || (item.seriesName ? splitSeries(item.seriesName).series_number : null),
            pageCount: item.numPages || null,
            bookUrl: item.bookUrl
          };
        });

        // Fetch extra details for the first 5 results in parallel to keep it fast
        results = await Promise.all(rawResults.slice(0, 5).map(async (res: any) => {
          const details = await fetchGoodreadsDetails(res.bookUrl);
          if (details) {
            return {
              ...res,
              isbn: details.isbn || res.isbn,
              asin: details.asin || res.asin,
              pageCount: details.pageCount || res.pageCount,
              publisher: details.publisher || res.publisher,
              publishedDate: details.publishedDate || res.publishedDate,
              description: details.description || res.description,
              categories: details.categories || res.categories
            };
          }
          return res;
        }));

        // Add the rest of the results without extra details
        if (rawResults.length > 5) {
          results = [...results, ...rawResults.slice(5)];
        }
      }

      res.json(results);
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message === 'Aborted') {
        console.log(`[Search API] Request aborted for query: ${q}`);
        // Express handles closed connections, no need to send response
        return;
      }
      console.error('Search error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // Goodreads CSV Import
  app.post('/api/import/goodreads', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { format } = req.body;

    try {
      // Read file and remove UTF-8 BOM if present
      const fileContent = fs.readFileSync(req.file.path, 'utf8').replace(/^\uFEFF/, '');
      const results = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: 'greedy'
      });
      
      const books = results.data as any[];
      const booksToAdd: any[] = [];
      const coverFetchTasks: { originalRow: any, cleanTitle: string }[] = [];

      for (const row of books) {
        if (!row.Title || !row.Author) continue;

        const isbn13Str = String(row.ISBN13 || '');
        const isbnStr = String(row.ISBN || '');
        const isbn = isbn13Str.replace(/="|"|'/g, '') || isbnStr.replace(/="|"|'/g, '');

        // Smarter format inference
        let inferredFormat = 'Book';
        const binding = String(row.Binding || '').toLowerCase();
        const shelvesStr = String(row.Bookshelves || '').toLowerCase();
        const title = String(row.Title || '').toLowerCase();
        
        if (binding.includes('audio') || shelvesStr.includes('audiobook') || shelvesStr.includes('audio') || title.includes('(audiobook)')) {
          inferredFormat = 'Audiobook';
        }

        // Process shelves for status and tags
        const rawExclusive = row['Exclusive Shelf'] || '';
        const rawShelves = row.Bookshelves || '';
        
        const allShelves = [rawExclusive, ...rawShelves.split(',')]
          .map((s: string) => s.trim())
          .filter(Boolean);
          
        let finalStatus = 'Backlog';
        let isDnf = false;
        
        const allShelvesLower = allShelves.map(s => s.toLowerCase());
        
        if (allShelvesLower.includes('currently-reading')) {
          finalStatus = 'Reading';
        } else if (allShelvesLower.includes('did-not-finish')) {
          finalStatus = 'Read';
          isDnf = true;
        } else if (allShelvesLower.includes('read')) {
          finalStatus = 'Read';
        } else if (allShelvesLower.includes('to-read')) {
          finalStatus = 'Wishlist';
        }

        // Filter out special shelves from tags
        const specialShelves = ['to-read', 'currently-reading', 'read', 'did-not-finish'];
        let cleanTagsArray = allShelves.filter(s => !specialShelves.includes(s.toLowerCase()));
        
        if (isDnf) {
          cleanTagsArray.push('dropped');
        }
        
        // Remove duplicates
        cleanTagsArray = [...new Set(cleanTagsArray)];
        const cleanTags = cleanTagsArray.join(', ');

        let finishedReadingDate = undefined;
        if (!isDnf && row['Date Read']) {
          try {
            const parsedDate = new Date(row['Date Read']);
            if (!isNaN(parsedDate.getTime())) {
              finishedReadingDate = parsedDate.toISOString().split('T')[0];
            }
          } catch (e) {
            // Ignore invalid dates
          }
        }

        let startedReadingDate = undefined;
        if (row['Date Added']) {
          try {
            const parsedDate = new Date(row['Date Added']);
            if (!isNaN(parsedDate.getTime())) {
              startedReadingDate = parsedDate.toISOString().split('T')[0];
            }
          } catch (e) {
            // Ignore invalid dates
          }
        }

        const { title: cleanTitle, series: parsedSeries, series_number: parsedSeriesNumber } = parseGoodreadsTitle(row.Title);
        
        let ratingValue = parseInt(row['My Rating']);
        const validRating = (!isNaN(ratingValue) && ratingValue >= 1 && ratingValue <= 5) ? ratingValue : undefined;

        const book: any = {
          title: cleanTitle,
          author: row.Author,
          isbn: isbn,
          status: finalStatus as any,
          format: format || inferredFormat,
          rating: validRating,
          started_reading: startedReadingDate,
          finished_reading: finishedReadingDate,
          notes: row['My Review'] || undefined,
          publisher: row.Publisher,
          page_count: parseInt(row['Number of Pages']) || undefined,
          published_date: row['Year Published'],
          tags: cleanTags,
          series: parsedSeries,
          series_number: parsedSeriesNumber,
          metadata_source: 'goodreads'
        };

        booksToAdd.push(book);
        coverFetchTasks.push({ originalRow: row, cleanTitle });
      }

      const addedBooks = addBooks(booksToAdd);
      const importedCount = addedBooks.length;

      // Process covers asynchronously in the background
      (async () => {
        for (let i = 0; i < addedBooks.length; i++) {
          const addedBook = addedBooks[i];
          const task = coverFetchTasks[i];
          const row = task.originalRow;
          const isbn13Str = String(row.ISBN13 || '');
          const isbnStr = String(row.ISBN || '');
          const isbn = isbn13Str.replace(/="|"|'/g, '') || isbnStr.replace(/="|"|'/g, '');
          const bookId = row['Book Id'];
          
          try {
            const coverUrl = await fetchCoverUrl(task.cleanTitle, row.Author, isbn, bookId);
            if (coverUrl) {
              const ext = '.jpg';
              const fileName = `cover_${addedBook.id}${ext}`;
              const filePath = path.join(coversDir, fileName);
              await downloadImage(coverUrl, filePath);
              updateBook(addedBook.id!, { cover_url: `/covers/${fileName}` });
            }
          } catch (e) {
            console.error(`Failed to download cover for imported book ${addedBook.id}:`, e);
          }
          
          // Add a small delay to avoid hitting API rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      })();

      fs.unlinkSync(req.file!.path);
      res.json({ success: true, count: importedCount });
    } catch (error) {
      console.error('Goodreads import error:', error);
      res.status(500).json({ error: 'Failed to import Goodreads data' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
