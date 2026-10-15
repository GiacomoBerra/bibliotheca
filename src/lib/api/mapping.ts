import type { Book, BookInput, BookStatus, MarcField, DeweySource } from "./types";
import { BOOK_STATUSES, DEWEY_SOURCES } from "./types";

/** Riga della tabella public.books come restituita da PostgREST. */
export interface BookRow {
  id: string;
  title: string;
  authors: string[] | null;
  isbn: string | null;
  publisher: string | null;
  publication_place: string | null;
  publication_year: string | null;
  language: string | null;
  physical_description: string | null;
  notes: string | null;
  subjects: string[] | null;
  dewey: string | null;
  dewey_notes: string | null;
  dewey_source: string | null;
  shelf_mark: string | null;
  status: string;
  marc_leader: string | null;
  marc_fields: unknown;
  created_at: string;
  updated_at: string;
}

export const BOOK_COLUMNS =
  "id,title,authors,isbn,publisher,publication_place,publication_year,language,physical_description,notes,subjects,dewey,dewey_notes,dewey_source,shelf_mark,status,marc_leader,marc_fields,created_at,updated_at";

function isMarcField(f: unknown): f is MarcField {
  if (!f || typeof f !== "object") return false;
  const o = f as Record<string, unknown>;
  if (typeof o["tag"] !== "string") return false;
  if (typeof o["value"] === "string") return true;
  return Array.isArray(o["subfields"]) && o["subfields"].every((s) => s && typeof (s as Record<string, unknown>)["code"] === "string" && typeof (s as Record<string, unknown>)["value"] === "string");
}

export function rowToBook(r: BookRow): Book {
  const status: BookStatus = (BOOK_STATUSES as readonly string[]).includes(r.status) ? (r.status as BookStatus) : "bozza";
  const marc = Array.isArray(r.marc_fields) && r.marc_fields.every(isMarcField) ? (r.marc_fields as MarcField[]) : null;
  return {
    id: r.id,
    title: r.title,
    authors: r.authors ?? [],
    isbn: r.isbn ?? "",
    publisher: r.publisher ?? "",
    publicationPlace: r.publication_place ?? "",
    publicationYear: r.publication_year ?? "",
    language: r.language ?? "",
    physicalDescription: r.physical_description ?? "",
    notes: r.notes ?? "",
    subjects: r.subjects ?? [],
    dewey: r.dewey ?? "",
    deweyNotes: r.dewey_notes ?? "",
    deweySource: (DEWEY_SOURCES as readonly string[]).includes(r.dewey_source ?? "") ? (r.dewey_source as DeweySource) : "",
    shelfMark: r.shelf_mark ?? "",
    status,
    marcLeader: r.marc_leader,
    marcFields: marc,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const nullIfEmpty = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const cleanList = (l: string[]): string[] => l.map((x) => x.trim()).filter(Boolean);

/** Dati da scrivere: NON include user_id (lo imposta il database con auth.uid()). */
export function bookToRow(b: BookInput) {
  return {
    title: b.title.trim(),
    authors: cleanList(b.authors),
    isbn: nullIfEmpty(b.isbn),
    publisher: nullIfEmpty(b.publisher),
    publication_place: nullIfEmpty(b.publicationPlace),
    publication_year: nullIfEmpty(b.publicationYear),
    language: nullIfEmpty(b.language),
    physical_description: nullIfEmpty(b.physicalDescription),
    notes: nullIfEmpty(b.notes),
    subjects: cleanList(b.subjects),
    dewey: nullIfEmpty(b.dewey),
    dewey_notes: nullIfEmpty(b.deweyNotes),
    dewey_source: b.deweySource === "" ? null : b.deweySource,
    shelf_mark: nullIfEmpty(b.shelfMark),
    status: b.status,
    marc_leader: b.marcLeader,
    marc_fields: b.marcFields,
  };
}

/** Normalizza la ricerca: minuscole, spazi compattati, al massimo 8 termini. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      // Un ISBN scritto con i trattini viene cercato nella forma senza trattini (sempre presente in search_text).
      const bare = t.replace(/-/g, "");
      return /^[\d-]+x?$/.test(t) && t.includes("-") && (bare.length === 10 || bare.length === 13) ? bare : t;
    })
    .slice(0, 8);
}

/** Rende letterali i caratteri speciali di LIKE (% _ \). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
