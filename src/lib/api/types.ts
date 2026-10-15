export const BOOK_STATUSES = ["bozza", "da revisionare", "catalogato"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/** Un sottocampo MARC21: codice di un carattere + valore. */
export interface MarcSubfield { code: string; value: string }
/** Campo di controllo (001–009): solo valore. */
export interface MarcControlField { tag: string; value: string }
/** Campo dati: indicatori + sottocampi ordinati e ripetibili. */
export interface MarcDataField { tag: string; ind1: string; ind2: string; subfields: MarcSubfield[] }
export type MarcField = MarcControlField | MarcDataField;

/** Campi modificabili di una scheda. I testi assenti sono stringhe vuote (nel DB: NULL). */
export interface BookInput {
  title: string;
  authors: string[];
  isbn: string;
  publisher: string;
  publicationPlace: string;
  publicationYear: string;
  language: string;
  physicalDescription: string;
  notes: string;
  subjects: string[];
  dewey: string;
  shelfMark: string;
  status: BookStatus;
  marcLeader: string | null;
  marcFields: MarcField[] | null;
}

export interface Book extends BookInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type SortKey = "aggiornamento" | "titolo" | "autore" | "anno";
export type SortDir = "asc" | "desc";

export interface ListOptions {
  query?: string;
  status?: BookStatus | "tutti";
  sort?: SortKey;
  dir?: SortDir;
  /** pagina da 1 */
  page?: number;
  pageSize?: number;
}

export interface BookPage { items: Book[]; total: number; page: number; pageSize: number }

export interface CatalogStats {
  total: number;
  byStatus: Record<BookStatus, number>;
  publishers: number;
  subjects: number;
}

/** Contratto del livello dati. L'unica implementazione di produzione usa Supabase (RLS lato database). */
export interface BooksApi {
  listBooks(options?: ListOptions): Promise<BookPage>;
  getBook(id: string): Promise<Book | null>;
  createBook(input: BookInput): Promise<Book>;
  updateBook(id: string, input: BookInput): Promise<Book>;
  deleteBook(id: string): Promise<void>;
  getStats(): Promise<CatalogStats>;
  /** Tutte le schede dell'utente (per l'esportazione/backup), lette a pagine. */
  listAllBooks(): Promise<Book[]>;
}

export function emptyBookInput(): BookInput {
  return {
    title: "", authors: [], isbn: "", publisher: "", publicationPlace: "", publicationYear: "",
    language: "", physicalDescription: "", notes: "", subjects: [], dewey: "", shelfMark: "",
    status: "bozza", marcLeader: null, marcFields: null,
  };
}
