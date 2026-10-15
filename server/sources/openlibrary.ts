import { bareIsbn, toIsbn10, toIsbn13 } from "../../src/lib/sources/isbn";
import type { LookupQuery, SourceRecord } from "../../src/lib/sources/types";
import { getJson, num, str, strList, type Source, type SourceContext } from "./source";

/**
 * Open Library (API ufficiali, senza chiave). Regole d'uso rispettate: richieste solo su azione dell'utente,
 * risultati limitati, User-Agent identificativo, nessun download massivo, nessuno scraping HTML.
 * - Con ISBN: Books API (`/api/books?bibkeys=ISBN:…&jscmd=data`) → dati di UNA edizione.
 * - Senza ISBN: `/search.json` → risultati a livello di OPERA.
 */
const BASE = "https://openlibrary.org";
const FIELDS = "key,title,subtitle,author_name,isbn,publisher,publish_place,first_publish_year,language,number_of_pages_median,subject,cover_i,cover_edition_key";
const LIMIT = 10;

const names = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str((x as { name?: unknown })?.name)).filter((x): x is string => Boolean(x)) : []);

export function parseEdition(isbn: string, raw: unknown): SourceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as any;
  const title = str(d.title);
  if (!title) return null;
  const ids = (d.identifiers ?? {}) as any;
  const i13 = strList(ids.isbn_13).map(bareIsbn);
  const i10 = strList(ids.isbn_10).map(bareIsbn);
  const url = str(d.url);
  const cover = (d.cover ?? {}) as any;
  const key = str(d.key) ?? isbn;
  return {
    source: "openlibrary", sourceLabel: "Open Library", externalId: key,
    ...(url ? { sourceUrl: url.startsWith("http") ? url : BASE + url } : {}),
    granularity: "edizione", title,
    ...(str(d.subtitle) ? { subtitle: str(d.subtitle)! } : {}),
    authors: names(d.authors),
    ...(i10[0] ?? toIsbn10(isbn) ? { isbn10: i10[0] ?? toIsbn10(isbn)! } : {}),
    ...(i13[0] ?? toIsbn13(isbn) ? { isbn13: i13[0] ?? toIsbn13(isbn)! } : {}),
    isbns: [...new Set([...i13, ...i10])],
    ...(names(d.publishers)[0] ? { publisher: names(d.publishers).join("; ") } : {}),
    ...(names(d.publish_places)[0] ? { publicationPlace: names(d.publish_places).join("; ") } : {}),
    ...(str(d.publish_date) ? { publicationDate: str(d.publish_date)! } : {}),
    ...(num(d.number_of_pages) ? { pages: num(d.number_of_pages)! } : {}),
    subjects: names(d.subjects),
    ...(str(cover.medium) ?? str(cover.large) ?? str(cover.small) ? { coverUrl: (str(cover.medium) ?? str(cover.large) ?? str(cover.small))!.replace(/^http:/, "https:") } : {}),
  };
}

export function parseWorkDoc(raw: unknown): SourceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as any;
  const title = str(d.title);
  const key = str(d.key);
  if (!title || !key) return null;
  const isbns = [...new Set(strList(d.isbn).map(bareIsbn))].slice(0, 30);
  const publishers = strList(d.publisher);
  const places = strList(d.publish_place);
  const langs = strList(d.language);
  const coverId = num(d.cover_i);
  return {
    source: "openlibrary", sourceLabel: "Open Library", externalId: key, sourceUrl: BASE + key,
    // Un risultato di ricerca è un'OPERA: ISBN, editori e lingue elencati possono appartenere a edizioni diverse.
    granularity: "opera", title,
    ...(str(d.subtitle) ? { subtitle: str(d.subtitle)! } : {}),
    authors: strList(d.author_name), isbns,
    ...(num(d.first_publish_year) ? { publicationDate: String(num(d.first_publish_year)) } : {}),
    ...(publishers.length === 1 ? { publisher: publishers[0]! } : {}),
    ...(places.length === 1 ? { publicationPlace: places[0]! } : {}),
    ...(langs.length === 1 ? { language: langs[0]! } : {}),
    ...(num(d.number_of_pages_median) ? { pages: num(d.number_of_pages_median)! } : {}),
    subjects: strList(d.subject).slice(0, 12),
    ...(coverId ? { coverUrl: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` } : {}),
  };
}

export function searchUrl(q: LookupQuery): string {
  const p = new URLSearchParams({ limit: String(LIMIT), fields: FIELDS });
  if (q.title || q.author || q.publisher) {
    if (q.title) p.set("title", q.title);
    if (q.author) p.set("author", q.author);
    if (q.publisher) p.set("publisher", q.publisher);
    if (q.q) p.set("q", q.q);
  } else {
    p.set("q", q.q ?? "");
  }
  return `${BASE}/search.json?${p.toString()}`;
}

export const openLibrary: Source = {
  id: "openlibrary",
  label: "Open Library",
  async search(q: LookupQuery, ctx: SourceContext): Promise<SourceRecord[]> {
    if (q.isbn) {
      const isbn = bareIsbn(q.isbn);
      const key = `ISBN:${isbn}`;
      const json = (await getJson(`${BASE}/api/books?${new URLSearchParams({ bibkeys: key, format: "json", jscmd: "data" })}`, ctx)) as Record<string, unknown> | null;
      const rec = json && typeof json === "object" ? parseEdition(isbn, json[key]) : null;
      return rec ? [rec] : [];
    }
    const json = (await getJson(searchUrl(q), ctx)) as { docs?: unknown } | null;
    const docs = Array.isArray(json?.docs) ? json!.docs : [];
    return docs.slice(0, LIMIT).map(parseWorkDoc).filter((r): r is SourceRecord => r !== null);
  },
};
