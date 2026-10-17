import { bareIsbn, toIsbn10, toIsbn13 } from "../../src/lib/sources/isbn";
import type { LookupQuery, SourceRecord } from "../../src/lib/sources/types";
import { getJson, num, str, strList, type Source, type SourceContext } from "./source";

/**
 * Google Books API v1 (`volumes`). La documentazione ufficiale indica che le richieste devono avere una chiave
 * API o un token: se la chiave non è configurata (variabile d'ambiente `GOOGLE_BOOKS_API_KEY`, solo sul server)
 * la richiesta viene tentata comunque e, se Google la rifiuta, la fonte risulta "non disponibile".
 * Nessun piano a pagamento: la chiave gratuita eventuale la crea il proprietario.
 */
const BASE = "https://www.googleapis.com/books/v1/volumes";
const quote = (s: string) => `"${s.replace(/"/g, "")}"`;

export function buildQuery(q: LookupQuery): string {
  if (q.isbn) return `isbn:${bareIsbn(q.isbn)}`;
  const parts: string[] = [];
  if (q.title) parts.push(`intitle:${quote(q.title)}`);
  if (q.author) parts.push(`inauthor:${quote(q.author)}`);
  if (q.publisher) parts.push(`inpublisher:${quote(q.publisher)}`);
  if (parts.length === 0 && q.q) parts.push(q.q);
  return parts.join(" ");
}

export function parseVolume(raw: unknown): SourceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as any;
  const info = (v.volumeInfo ?? {}) as any;
  const title = str(info.title);
  const id = str(v.id);
  if (!title || !id) return null;
  const ids = Array.isArray(info.industryIdentifiers) ? (info.industryIdentifiers as any[]) : [];
  const pick = (t: string) => ids.filter((x) => x?.type === t).map((x) => str(x.identifier)).filter((x): x is string => Boolean(x)).map(bareIsbn);
  const i13 = pick("ISBN_13");
  const i10 = pick("ISBN_10");
  const links = (info.imageLinks ?? {}) as any;
  const cover = str(links.thumbnail) ?? str(links.smallThumbnail);
  const infoLink = str(info.infoLink);
  return {
    source: "googlebooks", sourceLabel: "Google Books", externalId: id,
    ...(infoLink ? { sourceUrl: infoLink.replace(/^http:/, "https:") } : {}),
    granularity: "edizione", title,
    ...(str(info.subtitle) ? { subtitle: str(info.subtitle)! } : {}),
    authors: strList(info.authors),
    ...((i10[0] ?? (i13[0] ? toIsbn10(i13[0]) : null)) ? { isbn10: (i10[0] ?? toIsbn10(i13[0]!))! } : {}),
    ...((i13[0] ?? (i10[0] ? toIsbn13(i10[0]) : null)) ? { isbn13: (i13[0] ?? toIsbn13(i10[0]!))! } : {}),
    isbns: [...new Set([...i13, ...i10])],
    ...(str(info.publisher) ? { publisher: str(info.publisher)! } : {}),
    ...(str(info.publishedDate) ? { publicationDate: str(info.publishedDate)! } : {}),
    ...(str(info.language) ? { language: str(info.language)! } : {}),
    ...(num(info.pageCount) ? { pages: num(info.pageCount)! } : {}),
    ...(str(info.description) ? { description: str(info.description)! } : {}),
    subjects: strList(info.categories),
    ...(cover ? { coverUrl: cover.replace(/^http:/, "https:") } : {}),
  };
}

export const googleBooks: Source = {
  id: "googlebooks",
  label: "Google Books",
  async search(q: LookupQuery, ctx: SourceContext): Promise<SourceRecord[]> {
    const query = buildQuery(q);
    if (!query) return [];
    const p = new URLSearchParams({ q: query, maxResults: "10", printType: "books" });
    const key = ctx.env("GOOGLE_BOOKS_API_KEY");
    if (key) p.set("key", key);
    const json = (await getJson(`${BASE}?${p.toString()}`, ctx)) as { items?: unknown } | null;
    const items = Array.isArray(json?.items) ? json!.items : [];
    return items.map(parseVolume).filter((r): r is SourceRecord => r !== null);
  },
};
