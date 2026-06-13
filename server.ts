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

// --- Open Library API Helpers ---
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

let openLibraryRequestQueue: Promise<any> = Promise.resolve();
const OL_MIN_GAP = 1000; // 1 second gap between requests is safe and polite

async function openLibraryFetch(url: string, signal?: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    openLibraryRequestQueue = openLibraryRequestQueue.then(async () => {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      
      try {
        const response = await fetch(url, {
          signal,
          headers: {
            'User-Agent': 'BookWarpTzeentchTracker/1.0 (Ebert.Marlon@gmail.com; Elias-Warp-Archive)'
          }
        });
        
        // Wait OL_MIN_GAP before letting next request through
        await new Promise(r => setTimeout(r, OL_MIN_GAP));
        return response;
      } catch (e: any) {
        if (e.name === 'AbortError' || e.message === 'Aborted') {
          throw e;
        }
        console.error(`[Open Library] Fetch error:`, e);
        // Wait even on error to protect the queue
        await new Promise(r => setTimeout(r, OL_MIN_GAP));
        throw e;
      }
    }).then(resolve).catch((err) => {
      if (err.name === 'AbortError' || err.message === 'Aborted') {
        reject(err);
      } else {
        // Return a 500 response if it failed
        console.error(`[Open Library] Request failed:`, err);
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

async function fetchAudibleProducts(query: string, limit: number = 10, signal?: AbortSignal) {
  const normQ = query.trim();
  const isAsinQuery = /^B0[A-Z0-9]{8}$/i.test(normQ) || /^[A-Z0-9]{10}$/i.test(normQ);

  const domains = isAsinQuery 
    ? ['api.audible.com', 'api.audible.co.uk', 'api.audible.de', 'api.audible.ca', 'api.audible.com.au'] 
    : ['api.audible.com'];

  const fetchResults = await Promise.all(
    domains.map(async (domain) => {
      try {
        const url = `https://${domain}/1.0/catalog/products?keywords=${encodeURIComponent(normQ)}&response_groups=product_attrs,product_desc,contributors,media,series,category_ladders&num_results=${limit}`;
        const res = await fetch(url, { signal });
        if (res.ok) {
          const data = await res.json();
          return (data.products || []).filter((p: any) => p && p.title);
        }
      } catch (e) {
        console.error(`[Audible] Fetch error from ${domain}:`, e);
      }
      return [];
    })
  );

  const seenAsins = new Set<string>();
  const merged: any[] = [];
  
  for (const list of fetchResults) {
    for (const prod of list) {
      if (prod && prod.asin && !seenAsins.has(prod.asin)) {
        seenAsins.add(prod.asin);
        merged.push(prod);
      }
    }
  }
  return merged;
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

    let url = '';
    if (isbn) {
      const cleanIsbn = isbn.replace(/\D/g, '');
      if (cleanIsbn) {
        url = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(cleanIsbn)}&limit=1`;
      }
    }
    
    if (!url) {
      const cleanTitle = title.replace(/\s*\(.*?\)\s*$/, '').trim();
      url = `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitle)}&author=${encodeURIComponent(author)}&limit=1`;
    }
    
    console.log(`[Open Library] Fetching cover with URL: ${url}`);
    let res = await openLibraryFetch(url);
    
    if (!res.ok) {
      console.error(`[Open Library] Cover fetch API error (${res.status})`);
      return undefined;
    }

    let data = await res.json();
    
    // Retry with broader search if no results and not searching by ISBN
    if ((!data.docs || data.docs.length === 0) && !isbn) {
      const cleanTitle = title.replace(/\s*\(.*?\)\s*$/, '').trim();
      console.log(`[Open Library] Retrying cover fetch with search title only: ${cleanTitle}`);
      url = `https://openlibrary.org/search.json?q=${encodeURIComponent(cleanTitle)}&limit=1`;
      res = await openLibraryFetch(url);
      if (res.ok) data = await res.json();
    }

    if (data.docs && data.docs.length > 0) {
      const doc = data.docs[0];
      if (doc.cover_i) {
        return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
      } else if (doc.isbn && doc.isbn.length > 0) {
        return `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-L.jpg`;
      }
    }
  } catch (error) {
    console.error('Failed to fetch cover URL:', error);
  }
  return undefined;
}

async function fetchOldestEdition(workKey: string): Promise<any> {
  try {
    const cleanKey = workKey.replace(/^\/+/, '');
    console.log(`[Open Library] Fetching editions list for work: https://openlibrary.org/${cleanKey}/editions.json`);
    const res = await openLibraryFetch(`https://openlibrary.org/${cleanKey}/editions.json?limit=100`);
    if (!res.ok) return null;
    const data = await res.json();
    const entries = data.entries || [];
    if (entries.length === 0) return null;

    function parseYear(dateStr?: string): number {
      if (!dateStr) return Infinity;
      const match = dateStr.match(/\b(17|18|19|20)\d{2}\b/);
      return match ? parseInt(match[0], 10) : Infinity;
    }

    const sorted = [...entries].sort((a, b) => {
      const yearA = parseYear(a.publish_date);
      const yearB = parseYear(b.publish_date);
      
      if (yearA !== yearB) {
        return yearA - yearB; // Earlier year is better
      }
      
      // Prefer having publisher
      const hasPubA = (a.publishers && a.publishers.length > 0) ? 1 : 0;
      const hasPubB = (b.publishers && b.publishers.length > 0) ? 1 : 0;
      if (hasPubA !== hasPubB) {
        return hasPubB - hasPubA;
      }
      
      // Prefer having isbn
      const hasIsbnA = (a.isbn_13 || a.isbn_10) ? 1 : 0;
      const hasIsbnB = (b.isbn_13 || b.isbn_10) ? 1 : 0;
      if (hasIsbnA !== hasIsbnB) {
        return hasIsbnB - hasIsbnA;
      }

      return 0;
    });

    return sorted[0] || null;
  } catch (error) {
    console.error('[Open Library] Error in fetchOldestEdition:', error);
  }
  return null;
}

async function fetchOpenLibraryData(urlOrKey: string, book: any): Promise<Partial<Book> | null> {
  let workKey: string | null = null;
  let editionKey: string | null = null;
  let isbn: string | null = null;

  // Analyze urlOrKey (could be metadata_source)
  if (urlOrKey) {
    const workMatch = urlOrKey.match(/\/works\/(OL\d+[A-Z])/i);
    const bookMatch = urlOrKey.match(/\/books\/(OL\d+[A-Z])/i);
    const isbnMatch = urlOrKey.match(/\/isbn\/(\d+)/i);
    
    if (workMatch) workKey = `/works/${workMatch[1]}`;
    if (bookMatch) editionKey = `/books/${bookMatch[1]}`;
    if (isbnMatch) isbn = isbnMatch[1];
  }

  // If we don't have enough keys but we have book's isbn in database
  if (!isbn && book?.isbn) {
    isbn = book.isbn.replace(/\D/g, '');
  }

  const explicitEdition = !!(urlOrKey && (urlOrKey.includes('/books/') || urlOrKey.includes('/isbn/')));
  let editionData: any = null;
  let workData: any = null;

  // 1. Fetch Edition Data (if we have editionKey or isbn)
  if (editionKey) {
    try {
      console.log(`[Open Library] Fetching edition details: https://openlibrary.org${editionKey}.json`);
      const res = await openLibraryFetch(`https://openlibrary.org${editionKey}.json`);
      if (res.ok) editionData = await res.json();
    } catch (err) {
      console.error('[Open Library] Error fetching edition key:', err);
    }
  } else if (isbn) {
    try {
      console.log(`[Open Library] Fetching edition details by ISBN: https://openlibrary.org/isbn/${isbn}.json`);
      const res = await openLibraryFetch(`https://openlibrary.org/isbn/${isbn}.json`);
      if (res.ok) editionData = await res.json();
    } catch (err) {
      console.error('[Open Library] Error fetching isbn details:', err);
    }
  }

  // If we fetched editionData, find workKey inside it
  if (editionData && editionData.works && editionData.works.length > 0) {
    workKey = editionData.works[0].key;
  }

  // 2. Fetch Work Data (if we have workKey)
  if (workKey) {
    try {
      console.log(`[Open Library] Fetching work details: https://openlibrary.org${workKey}.json`);
      const res = await openLibraryFetch(`https://openlibrary.org${workKey}.json`);
      if (res.ok) workData = await res.json();
    } catch (err) {
      console.error('[Open Library] Error fetching work key details:', err);
    }

    // Now fetch the oldest/primary edition to ensure we get the original publisher and year!
    const oldestEd = await fetchOldestEdition(workKey);
    if (oldestEd) {
      if (!explicitEdition) {
        editionData = oldestEd;
      } else {
        editionData = editionData || oldestEd;
      }
    }
  }

  // 3. Fallback to search.json if we still don't have edition or work data
  if (!editionData && !workData) {
    let searchUrl = '';
    const fieldsParam = 'key,title,author_name,cover_i,isbn,publisher,publish_date,first_publish_year,number_of_pages,number_of_pages_median,subject,series_name,series_position';
    if (isbn) {
      searchUrl = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=${fieldsParam}&limit=1`;
    } else {
      const cleanTitle = book.title.replace(/\s*\(.*?\)\s*$/, '').trim();
      searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitle)}&author=${encodeURIComponent(book.author)}&fields=${fieldsParam}&limit=1`;
    }

    console.log(`[Open Library] Fallback to search.json: ${searchUrl}`);
    try {
      const res = await openLibraryFetch(searchUrl);
      if (res.ok) {
        const searchResult = await res.json();
        if (searchResult.docs && searchResult.docs.length > 0) {
          const doc = searchResult.docs[0];
          
          if (doc.key) workKey = doc.key;
          if (doc.edition_key && doc.edition_key.length > 0) editionKey = `/books/${doc.edition_key[0]}`;
          
          // Let's fetch them now for maximum completeness
          if (editionKey) {
            const edRes = await openLibraryFetch(`https://openlibrary.org${editionKey}.json`);
            if (edRes.ok) editionData = await edRes.json();
          }
          if (workKey) {
            const wkRes = await openLibraryFetch(`https://openlibrary.org${workKey}.json`);
            if (wkRes.ok) workData = await wkRes.json();
          }

          // Direct creation from search document if detail fetches fail
          if (!editionData && !workData) {
            console.log(`[Open Library] Creating metadata directly from search document`);
            let coverUrl = undefined;
            if (doc.cover_i) {
              coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
            } else if (doc.isbn && doc.isbn.length > 0) {
              coverUrl = `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-L.jpg`;
            }

            let seriesName = doc.series_name?.[0] || undefined;
            let seriesNumber = doc.series_position?.[0] || undefined;
            if (!seriesName && doc.series && doc.series.length > 0) {
              const seriesInfo = splitSeries(doc.series[0]);
              seriesName = seriesInfo.series;
              seriesNumber = seriesInfo.series_number;
            }

            return {
              title: doc.title,
              author: doc.author_name?.join(', ') || 'Unknown Author',
              description: doc.subject?.slice(0, 10).join(', ') || null,
              published_date: doc.first_publish_year?.toString() || doc.publish_date?.[0] || null,
              page_count: doc.number_of_pages_median || doc.number_of_pages || null,
              publisher: doc.publisher?.[0] || null,
              isbn: doc.isbn?.find((i: string) => i.replace(/\D/g, '').length === 13) || doc.isbn?.[0] || null,
              asin: doc.isbn?.[0] ? null : undefined,
              cover_url: coverUrl,
              metadata_source: `https://openlibrary.org${doc.key || ''}`,
              tags: doc.subject?.slice(0, 10).join(', ') || null,
              series: seriesName || null,
              series_number: seriesNumber || null,
            };
          }
        }
      }
    } catch (err) {
      console.error('[Open Library] Fallback search error:', err);
    }
  }

  // Assemble from rich editionData and workData
  if (editionData || workData) {
    const title = editionData?.title || workData?.title || book.title;
    const descriptionObject = workData?.description || editionData?.description;
    let description = null;
    if (descriptionObject) {
      if (typeof descriptionObject === 'string') {
        description = descriptionObject;
      } else if (descriptionObject.value) {
        description = descriptionObject.value;
      }
    }

    let coverUrl = undefined;
    if (editionData?.covers && editionData.covers.length > 0 && editionData.covers[0] > 0) {
      coverUrl = `https://covers.openlibrary.org/b/id/${editionData.covers[0]}-L.jpg`;
    } else if (workData?.covers && workData.covers.length > 0 && workData.covers[0] > 0) {
      coverUrl = `https://covers.openlibrary.org/b/id/${workData.covers[0]}-L.jpg`;
    } else if (editionData?.isbn_13 && editionData.isbn_13.length > 0) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${editionData.isbn_13[0]}-L.jpg`;
    } else if (editionData?.isbn_10 && editionData.isbn_10.length > 0) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${editionData.isbn_10[0]}-L.jpg`;
    }

    // Series info lookup
    let seriesName = undefined;
    let seriesNumber = undefined;
    const candidateSeries = editionData?.series || workData?.series;
    if (Array.isArray(candidateSeries) && candidateSeries.length > 0) {
      const firstSeries = candidateSeries[0];
      if (typeof firstSeries === 'string') {
        const split = splitSeries(firstSeries);
        seriesName = split.series;
        seriesNumber = split.series_number;
      } else if (firstSeries && typeof firstSeries === 'object') {
        // e.g. { series: { key: '/series/OL326110L' }, position: '1' }
        seriesNumber = firstSeries.position;
        const seriesKey = firstSeries.series?.key;
        if (seriesKey) {
          try {
            console.log(`[Open Library] Fetching named series key: https://openlibrary.org${seriesKey}.json`);
            const seriesRes = await openLibraryFetch(`https://openlibrary.org${seriesKey}.json`);
            if (seriesRes.ok) {
              const seriesData = await seriesRes.json();
              if (seriesData && seriesData.name) {
                seriesName = seriesData.name;
              }
            }
          } catch (err) {
            console.error('[Open Library] Error fetching series key name:', err);
          }
        }
      }
    } else if (typeof candidateSeries === 'string') {
      const split = splitSeries(candidateSeries);
      seriesName = split.series;
      seriesNumber = split.series_number;
    }

    // Subjects/Tags mapping
    const subjects = workData?.subjects || editionData?.subjects || [];
    const tags = subjects.length > 0 ? subjects.slice(0, 10).join(', ') : null;

    // ISBN mapping
    const isbn13 = editionData?.isbn_13?.[0] || null;
    const isbn10 = editionData?.isbn_10?.[0] || null;

    let authorName = undefined;
    if (editionData?.by_statement) {
      authorName = editionData.by_statement;
    }

    return {
      title: title,
      author: authorName || book.author,
      description: description ? stripHtml(description) : null,
      published_date: editionData?.publish_date || workData?.first_publish_date || null,
      page_count: editionData?.number_of_pages || null,
      publisher: editionData?.publishers?.[0] || null,
      isbn: isbn13 || isbn10 || isbn || null,
      asin: (isbn13 || isbn10) ? null : undefined,
      cover_url: coverUrl,
      metadata_source: `https://openlibrary.org${workKey || editionKey || ''}`,
      tags: tags,
      series: seriesName || null,
      series_number: seriesNumber || null,
    };
  }

  return null;
}

async function performMetadataRefresh(bookId: number, userProvider?: string, specificSourceUrl?: string): Promise<{ success: boolean, error?: string }> {
  const book = getBookById(bookId);
  if (!book) return { success: false, error: `Book ${bookId} not found` };

  let provider = userProvider;
  const sourceUrl = specificSourceUrl || book.metadata_source || '';

  if (!provider) {
    const source = sourceUrl.toLowerCase();
    if (source.includes('google')) provider = 'openlibrary'; // Map legacy google books references to openlibrary
    else if (source.includes('openlibrary') || source.includes('openlib')) provider = 'openlibrary';
    else if (source.includes('audible')) provider = 'audible';
    else if (source.includes('goodreads')) provider = 'goodreads';
    else provider = 'openlibrary'; // Fallback
  }

  // Set provider 'google' to 'openlibrary' to fully migrate
  if (provider === 'google') {
    provider = 'openlibrary';
  }

  try {
    let metadata: Partial<Book> | null = null;
    
    if (provider === 'openlibrary') {
      metadata = await fetchOpenLibraryData(sourceUrl, book);
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
      
      let products = await fetchAudibleProducts(query, 1);
      
      if (products.length === 0 && !asin && !book.asin) {
        const surname = getSurname(book.author);
        if (surname !== book.author) {
          query = `${book.title} ${surname}`;
          products = await fetchAudibleProducts(query, 1);
        }
      }

      if (products.length > 0) {
        const product = products[0];
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

        const isEbook = !!item.media?.ebookFile;
        const absFormat = isEbook ? 'Ebook' : 'Audiobook';

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
          format: absFormat, metadata_source: 'Audiobookshelf'
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
      const isSupported = source.includes('goodreads.com') || source.includes('audible.com') || source.includes('google.com') || source.includes('openlibrary.org');
      
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
      if (source === 'openlibrary' || source === 'google') {
        const details = await fetchOpenLibraryData(url, {});
        return res.json({
          isbn: details?.isbn || null,
          pageCount: details?.page_count || null,
          publisher: details?.publisher || null,
          publishedDate: details?.published_date || null,
          description: details?.description || null,
          series: details?.series || null,
          series_number: details?.series_number || null,
        });
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
    let { q, source = 'openlibrary' } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });

    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
    });

    try {
      let results: SearchResult[] = [];

      const normalizedQ = (q as string).replace(/[\s-]/g, '');
      const isOnlyNumbers = /^\d+$/.test(normalizedQ) || /^\d{9}[\dX]$/i.test(normalizedQ);
      const trimmedQ = (q as string).trim();
      const isAsin = /^B0[A-Z0-9]{8}$/i.test(trimmedQ);

      if (source === 'openlibrary' || source === 'google') {
        const cacheKey = `openlibrary:${q}`;
        const cached = searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          console.log(`[Open Library] Returning cached results for: ${q}`);
          return res.json(cached.data);
        }

        console.log(`[Open Library] Searching for: ${q}`);

        const isbnMatch = (q as string).match(/^isbn:\s*([a-zA-Z0-9]+)/i);
        const cleanIsbnValue = isOnlyNumbers ? normalizedQ : (isbnMatch ? isbnMatch[1].replace(/[\s-]/g, '') : null);

        let exactEditionFound = false;

        if (cleanIsbnValue) {
          try {
            console.log(`[Open Library] Performing exact edition lookup for ISBN: ${cleanIsbnValue}`);
            const edRes = await openLibraryFetch(`https://openlibrary.org/isbn/${cleanIsbnValue}.json`, abortController.signal);
            if (edRes.ok) {
              const edData = await edRes.json();
              
              const workKey = edData.works?.[0]?.key;
              let workData: any = null;
              let authorName = edData.by_statement || 'Unknown Author';
              let description = null;
              let categories = null;
              let seriesName = null;
              let seriesNumber = null;

              if (workKey) {
                const wkRes = await openLibraryFetch(`https://openlibrary.org${workKey}.json`, abortController.signal);
                if (wkRes.ok) {
                  workData = await wkRes.json();
                  const descObj = workData.description;
                  if (descObj) {
                    description = typeof descObj === 'string' ? descObj : (descObj.value || null);
                  }
                  if (workData.subjects && workData.subjects.length > 0) {
                    categories = workData.subjects.slice(0, 5).join(', ');
                  }
                  if (!edData.by_statement && workData.authors?.[0]?.author?.key) {
                    const authRes = await openLibraryFetch(`https://openlibrary.org${workData.authors[0].author.key}.json`, abortController.signal);
                    if (authRes.ok) {
                      const authData = await authRes.json();
                      if (authData.name) {
                        authorName = authData.name;
                      }
                    }
                  }
                }
              }

              let coverUrl = undefined;
              if (edData.covers && edData.covers.length > 0 && edData.covers[0] > 0) {
                coverUrl = `https://covers.openlibrary.org/b/id/${edData.covers[0]}-L.jpg`;
              } else {
                coverUrl = `https://covers.openlibrary.org/b/isbn/${cleanIsbnValue}-L.jpg`;
              }

              const candidateSeries = edData.series || workData?.series;
              if (Array.isArray(candidateSeries) && candidateSeries.length > 0) {
                const firstSeries = candidateSeries[0];
                if (typeof firstSeries === 'string') {
                  const split = splitSeries(firstSeries);
                  seriesName = split.series;
                  seriesNumber = split.series_number;
                } else if (firstSeries && typeof firstSeries === 'object') {
                  seriesNumber = firstSeries.position;
                  const seriesKey = firstSeries.series?.key;
                  if (seriesKey) {
                    try {
                      const sRes = await openLibraryFetch(`https://openlibrary.org${seriesKey}.json`, abortController.signal);
                      if (sRes.ok) {
                        const sData = await sRes.json();
                        if (sData.name) seriesName = sData.name;
                      }
                    } catch (e) {}
                  }
                }
              } else if (typeof candidateSeries === 'string') {
                const split = splitSeries(candidateSeries);
                seriesName = split.series;
                seriesNumber = split.series_number;
              }

              results = [{
                title: edData.title,
                author: authorName,
                isbn: cleanIsbnValue,
                asin: null,
                cover_url: coverUrl,
                description: description ? stripHtml(description) : (categories || null),
                pageCount: edData.number_of_pages || null,
                publishedDate: edData.publish_date || null,
                publisher: edData.publishers?.[0] || null,
                categories: categories,
                metadata_source: `https://openlibrary.org${edData.key}`,
                series: seriesName || null,
                series_number: seriesNumber || null,
              }];
              exactEditionFound = true;
            }
          } catch (err) {
            console.error('[Open Library] Exact edition fetch error, falling back:', err);
          }
        }

        if (!exactEditionFound) {
          const fieldsParam = 'key,title,author_name,cover_i,isbn,publisher,publish_date,first_publish_year,number_of_pages,number_of_pages_median,subject,series_name,series_position';
          let url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q as string)}&fields=${fieldsParam}&limit=20`;
          if (cleanIsbnValue) {
            url = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(cleanIsbnValue)}&fields=${fieldsParam}&limit=20`;
          }

          let response = await openLibraryFetch(url, abortController.signal);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Open Library] Search API error (${response.status}): ${errorText}`);
            return res.json([]);
          }

          const data = await response.json();
          
          results = (data.docs || []).map((doc: any) => {
            let coverUrl = undefined;
            if (doc.cover_i) {
              coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
            } else if (doc.isbn && doc.isbn.length > 0) {
              coverUrl = `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-L.jpg`;
            }
            
            const isbnVal = doc.isbn?.find((i: string) => i.replace(/\D/g, '').length === 13) || doc.isbn?.[0] || null;
            const pubDate = doc.first_publish_year?.toString() || doc.publish_date?.[0] || null;
            
            let seriesName = doc.series_name?.[0] || undefined;
            let seriesNumber = doc.series_position?.[0] || undefined;
            if (!seriesName && doc.series && doc.series.length > 0) {
              const split = splitSeries(doc.series[0]);
              seriesName = split.series;
              seriesNumber = split.series_number;
            }

            return {
              title: doc.title,
              author: doc.author_name?.join(', ') || 'Unknown Author',
              isbn: isbnVal,
              asin: null,
              cover_url: coverUrl,
              description: doc.subject?.slice(0, 10).join(', ') || null,
              pageCount: doc.number_of_pages_median || doc.number_of_pages || null,
              publishedDate: pubDate,
              publisher: doc.publisher?.[0] || null,
              categories: doc.subject?.slice(0, 5).join(', ') || null,
              metadata_source: `https://openlibrary.org${doc.key || ''}`,
              series: seriesName || null,
              series_number: seriesNumber || null,
            };
          });
        }

        // Cache the results
        searchCache.set(cacheKey, { data: results, timestamp: Date.now() });
      } else if (source === 'audible') {
        const requestedAsin = isAsin ? trimmedQ : null;

        let searchKeyword = q as string;
        if (requestedAsin) {
          searchKeyword = requestedAsin;
        }

        const products = await fetchAudibleProducts(searchKeyword, 10, abortController.signal);
        
        results = products.map((product: any) => {
          const authors = (product.authors || []).map((a: any) => a.name).join(', ');
          const narrators = (product.narrators || []).map((n: any) => n.name).join(', ');
          
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

        if (requestedAsin) {
          const exactMatch = results.find(item => item.asin?.toLowerCase() === requestedAsin.toLowerCase());
          if (exactMatch) {
            results = [exactMatch];
          }
        }
      } else if (source === 'goodreads') {
        const isbnMatch = (q as string).match(/^isbn:\s*([a-zA-Z0-9]+)/i);
        const cleanIsbnValue = isOnlyNumbers ? normalizedQ : (isbnMatch ? isbnMatch[1].replace(/[\s-]/g, '') : null);

        let searchQuery = q as string;
        if (cleanIsbnValue) {
          searchQuery = cleanIsbnValue;
        } else if (isAsin) {
          searchQuery = trimmedQ;
        }

        const response = await fetch(`https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(searchQuery)}`, {
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

        if (rawResults.length > 5) {
          results = [...results, ...rawResults.slice(5)];
        }

        if (cleanIsbnValue) {
          const exactMatch = results.find(item => {
            const cleanItemIsbn = item.isbn ? item.isbn.replace(/[^0-9X]/ig, '') : '';
            return cleanItemIsbn === cleanIsbnValue;
          });
          if (exactMatch) {
            results = [exactMatch];
          }
        } else if (isAsin) {
          const exactMatch = results.find(item => {
            return item.asin?.toLowerCase() === trimmedQ.toLowerCase();
          });
          if (exactMatch) {
            results = [exactMatch];
          }
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
        let inferredFormat = 'Print';
        const binding = String(row.Binding || '').toLowerCase();
        const shelvesStr = String(row.Bookshelves || '').toLowerCase();
        const title = String(row.Title || '').toLowerCase();
        
        if (binding.includes('audio') || shelvesStr.includes('audiobook') || shelvesStr.includes('audio') || title.includes('(audiobook)')) {
          inferredFormat = 'Audiobook';
        } else if (binding.includes('ebook') || binding.includes('kindle') || shelvesStr.includes('ebook') || shelvesStr.includes('kindle') || title.includes('(ebook)')) {
          inferredFormat = 'Ebook';
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

      res.json({ success: true, count: importedCount });
    } catch (error) {
      console.error('Goodreads import error:', error);
      res.status(500).json({ error: 'Failed to import Goodreads data' });
    } finally {
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (err) {
          console.error('Failed to delete temp file:', err);
        }
      }
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
