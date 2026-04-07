export type BookStatus = 'Wishlist' | 'Backlog' | 'Reading' | 'Read' | 'Dropped';
export type BookFormat = 'Book' | 'Audiobook';

export interface Book {
  id: number;
  title: string;
  author: string;
  narrator?: string;
  series?: string;
  series_number?: string;
  published_date?: string;
  metadata_source?: string;
  tags?: string;
  description?: string;
  isbn?: string;
  asin?: string;
  started_reading?: string;
  finished_reading?: string;
  status: BookStatus;
  format: BookFormat;
  rating?: number;
  cover_url?: string;
  page_count?: number;
  publisher?: string;
  notes?: string;
}

export interface SearchResult {
  title: string;
  author: string;
  narrator?: string;
  isbn?: string;
  asin?: string;
  cover_url?: string;
  description?: string;
  pageCount?: number;
  publishedDate?: string;
  publisher?: string;
  categories?: string;
  series?: string;
  series_number?: string;
  metadata_source?: string;
}

export interface SortField {
  id: string;
  direction: 'asc' | 'desc';
}

export interface UIConfig {
  viewPreferences: Record<BookStatus, 'cards' | 'list' | 'disabled' | 'show-with-read'>;
  listColumns: string[];
  cardFields: string[];
  sortFields?: SortField[];
  theme?: 'system' | 'light' | 'dark';
  absIntegrationEnabled?: boolean;
  absUrl?: string;
  absApiKey?: string;
  absLibrary?: string;
  lastAbsSyncDate?: string;
}
