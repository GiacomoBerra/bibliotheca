/** Tipi condivisi tra server (Netlify Function) e interfaccia per la ricerca bibliografica su fonti esterne. */

export type SourceId = "openlibrary" | "googlebooks" | "loc";

/** Una scheda così come la restituisce UNA fonte. Nessun campo è stato dedotto o completato dall'app. */
export interface SourceRecord {
  source: SourceId;
  sourceLabel: string;
  /** Identificativo del record nella fonte. */
  externalId: string;
  /** Collegamento alla pagina originale, se la fonte lo fornisce. */
  sourceUrl?: string;
  /** "edizione": dati di una pubblicazione concreta; "opera": la fonte descrive l'opera, non una singola edizione (ISBN, editore e anno possono riferirsi a edizioni diverse). */
  granularity: "edizione" | "opera";
  title: string;
  subtitle?: string;
  /** Nomi come forniti dalla fonte (di norma in ordine naturale, non invertiti secondo le regole catalografiche). */
  authors: string[];
  isbn10?: string;
  isbn13?: string;
  /** Tutti gli ISBN noti alla fonte per il record (per le opere possono appartenere a edizioni diverse). */
  isbns?: string[];
  publisher?: string;
  publicationPlace?: string;
  /** Anno o data come scritti dalla fonte. */
  publicationDate?: string;
  /** Lingua come codice o nome forniti dalla fonte (non convertiti). */
  language?: string;
  pages?: number;
  description?: string;
  /** Soggetti/categorie della fonte: valori suggeriti, NON intestazioni controllate. */
  subjects: string[];
  coverUrl?: string;
}

export interface LookupQuery {
  isbn?: string;
  title?: string;
  author?: string;
  publisher?: string;
  year?: string;
  /** Testo libero, usato quando non si dispone di campi distinti. */
  q?: string;
}

/**
 * Corrispondenza di un gruppo di risultati con la richiesta. Criteri (nessuna percentuale):
 * - esatta: la richiesta contiene un ISBN e il gruppo include lo stesso ISBN-13 (dopo normalizzazione);
 * - probabile: titolo uguale (dopo normalizzazione di maiuscole, accenti, punteggiatura e articolo iniziale)
 *   e TUTTI gli altri criteri forniti (autore, editore, anno) coincidono;
 * - simile: il titolo coincide in tutto o in parte, ma almeno un criterio fornito non coincide o manca.
 */
export type MatchKind = "esatta" | "probabile" | "simile";

export interface ResultGroup {
  id: string;
  match: MatchKind;
  /** Spiegazione leggibile dei criteri soddisfatti. */
  reason: string;
  /** true se mancano dati essenziali (titolo, autori, editore, anno, ISBN: meno di 3 su 4 tra autori, editore, anno, ISBN). */
  incomplete: boolean;
  missing: string[];
  /** Record delle diverse fonti che descrivono la stessa edizione. */
  records: SourceRecord[];
}

export type SourceStatus = "ok" | "errore" | "timeout" | "non_disponibile";
export interface SourceReport { id: SourceId; label: string; status: SourceStatus; count: number; message?: string; cached?: boolean }

export interface LookupResponse {
  groups: ResultGroup[];
  sources: SourceReport[];
  /** true se tutti i risultati vengono dalla cache. */
  cached: boolean;
}
