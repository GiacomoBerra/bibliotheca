export type BookStatus = "catalogato" | "da revisionare" | "bozza";

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string;
  publisher: string;
  year: number;
  subjects: string[];
  dewey: string;
  location: string;
  status: BookStatus;
}

export interface CatalogStats {
  total: number;
  byStatus: Record<BookStatus, number>;
  publishers: number;
  subjects: number;
}

/** Contratto del livello dati: l'implementazione demo verrà sostituita da una server-side. */
export interface BooksApi {
  readonly isDemo: boolean;
  listBooks(query?: string): Promise<Book[]>;
  getBook(id: string): Promise<Book | null>;
  getStats(): Promise<CatalogStats>;
}
