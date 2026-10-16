import type { BookAvailability, BookLoans, Loan, LoanFilter, LoanCorrection, LoanEditInput, LoanInput, LoanListOptions, LoanPage, LoanRestoreRecord, BookCopy, CopyInput, RestoreCopy, RestoreResult } from "./loans";
import type { LookupQuery, LookupResponse } from "@/lib/sources/types";

export const BOOK_STATUSES = ["bozza", "da revisionare", "catalogato"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/** Origine della proposta Dewey. Non attesta la correttezza: «verificata-ddc» è una dichiarazione di chi cataloga. */
export const DEWEY_SOURCES = ["manuale", "fonte-esterna", "verificata-ddc"] as const;
export type DeweySource = (typeof DEWEY_SOURCES)[number];
export const DEWEY_SOURCE_LABELS: Record<DeweySource, string> = {
  manuale: "Inserita a mano da chi cataloga",
  "fonte-esterna": "Proposta da una fonte esterna (non verificata)",
  "verificata-ddc": "Verificata sulle tavole DDC (dichiarazione di chi cataloga)",
};

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
  /** Note sulla scelta della notazione Dewey (edizione usata, motivazione…). */
  deweyNotes: string;
  /** "" = non indicata. */
  deweySource: DeweySource | "";
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
  /** filtro per disponibilità (prestiti attivi e non annullati, tutte le copie) */
  loan?: LoanFilter;
  sort?: SortKey;
  dir?: SortDir;
  /** pagina da 1 */
  page?: number;
  pageSize?: number;
}

/** `availability`: stato prestito di ogni libro della pagina, indicizzato per id (nessun dato personale: visibile anche al visualizzatore). */
export interface BookPage { items: Book[]; total: number; page: number; pageSize: number; availability: Record<string, BookAvailability> }

export interface CatalogStats {
  total: number;
  byStatus: Record<BookStatus, number>;
  publishers: number;
  subjects: number;
}

/** Contratto del livello dati. L'implementazione di produzione chiama le Netlify Functions (`/api/*`), che verificano la sessione Identity lato server. */
export interface BooksApi {
  listBooks(options?: ListOptions): Promise<BookPage>;
  getBook(id: string): Promise<Book | null>;
  createBook(input: BookInput): Promise<Book>;
  updateBook(id: string, input: BookInput): Promise<Book>;
  deleteBook(id: string): Promise<void>;
  getStats(): Promise<CatalogStats>;
  /** Tutte le schede dell'utente (per l'esportazione/backup), lette a pagine. */
  listAllBooks(): Promise<Book[]>;
  /** Cerca su fonti bibliografiche esterne (solo admin). Non modifica il catalogo. */
  lookupSources(query: LookupQuery, opts?: { refresh?: boolean }): Promise<LookupResponse>;
  /** Disponibilità e storico prestiti di un libro. Per il visualizzatore nome, recapito e note sono assenti (null). */
  listBookLoans(bookId: string): Promise<BookLoans>;
  /** Elenco globale dei prestiti con filtri (solo admin). */
  listLoans(options?: LoanListOptions): Promise<LoanPage>;
  createLoan(bookId: string, input: LoanInput): Promise<Loan>;
  /** `returnedDate` assente = oggi. Non cancella il prestito. */
  returnLoan(loanId: string, returnedDate?: string): Promise<Loan>;
  updateLoan(loanId: string, input: LoanEditInput): Promise<Loan>;
  /** Annulla un prestito registrato per errore (resta nello storico, con motivo e traccia). Solo admin. */
  voidLoan(loanId: string, reason: string): Promise<Loan>;
  /** Copie fisiche di un libro (anche il visualizzatore, senza dati personali). */
  listCopies(bookId: string): Promise<BookCopy[]>;
  /** Tutte le copie (solo admin; per il backup). */
  listAllCopies(): Promise<BookCopy[]>;
  addCopy(bookId: string, input: CopyInput): Promise<BookCopy>;
  updateCopy(copyId: string, input: CopyInput): Promise<BookCopy>;
  /** Ripristina da un backup prestiti e cronologia, tutto o niente (solo admin). */
  restoreLoans(loans: LoanRestoreRecord[], copies?: RestoreCopy[]): Promise<RestoreResult>;
  /** Annulla la registrazione di una restituzione: il prestito torna attivo, se la copia non è stata prestata di nuovo. Solo admin. */
  undoLoanReturn(loanId: string, reason: string): Promise<Loan>;
  /** Traccia delle correzioni di un prestito, dalla più recente. Solo admin. */
  listLoanCorrections(loanId: string): Promise<LoanCorrection[]>;
}

export function emptyBookInput(): BookInput {
  return {
    title: "", authors: [], isbn: "", publisher: "", publicationPlace: "", publicationYear: "",
    language: "", physicalDescription: "", notes: "", subjects: [], dewey: "", deweyNotes: "", deweySource: "", shelfMark: "",
    status: "bozza", marcLeader: null, marcFields: null,
  };
}
