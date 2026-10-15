import { BOOK_COLUMNS, bookToRow, escapeLike, rowToBook, searchTerms, type BookRow } from "../src/lib/api/mapping";
import { BOOK_STATUSES, type Book, type BookInput, type BookPage, type BookStatus, type CatalogStats, type ListOptions, type SortKey } from "../src/lib/api/types";
import type { Db } from "./db";

/**
 * Accesso ai dati. REGOLA: ogni query riceve `ownerId` (identità verificata lato server) e lo applica
 * SEMPRE come condizione. Nessuna funzione accetta un identificativo utente dal browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

// Whitelist: nessun valore dell'utente finisce nella clausola ORDER BY.
const ORDER: Record<SortKey, string> = {
  aggiornamento: "updated_at",
  titolo: "lower(title)",
  autore: "authors",
  anno: "publication_year",
};

export const DEFAULT_PAGE_SIZE = 25;

export async function listBooks(db: Db, ownerId: string, o: ListOptions = {}): Promise<BookPage> {
  const pageSize = Math.min(Math.max(Math.trunc(o.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), 100);
  const page = Math.max(Math.trunc(o.page ?? 1) || 1, 1);
  const sort: SortKey = o.sort && o.sort in ORDER ? o.sort : "aggiornamento";
  const dir = (o.dir ?? (sort === "aggiornamento" ? "desc" : "asc")) === "desc" ? "desc" : "asc";

  const params: unknown[] = [ownerId];
  const where = ["owner_id = $1"];
  for (const term of searchTerms(o.query ?? "")) {
    params.push(`%${escapeLike(term)}%`);
    where.push(`search_text like $${params.length} escape '\\'`);
  }
  if (o.status && o.status !== "tutti" && (BOOK_STATUSES as readonly string[]).includes(o.status)) {
    params.push(o.status);
    where.push(`status = $${params.length}`);
  }
  const clause = where.join(" and ");
  const total = Number((await db.query<{ n: string }>(`select count(*) as n from books where ${clause}`, params)).rows[0]?.n ?? 0);
  const rows = await db.query<BookRow>(
    `select ${BOOK_COLUMNS} from books where ${clause} order by ${ORDER[sort]} ${dir} nulls last, id limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  return { items: rows.rows.map(rowToBook), total, page, pageSize };
}

export async function getBook(db: Db, ownerId: string, id: string): Promise<Book | null> {
  if (!isUuid(id)) return null;
  const r = await db.query<BookRow>(`select ${BOOK_COLUMNS} from books where owner_id = $1 and id = $2`, [ownerId, id]);
  return r.rows[0] ? rowToBook(r.rows[0]) : null;
}

const WRITE_COLS = ["title", "authors", "isbn", "publisher", "publication_place", "publication_year", "language", "physical_description", "notes", "subjects", "dewey", "shelf_mark", "status", "marc_leader", "marc_fields"] as const;

function writeParams(input: BookInput): unknown[] {
  const row = bookToRow(input) as Record<string, unknown>;
  return WRITE_COLS.map((c) => (c === "marc_fields" ? (row[c] === null ? null : JSON.stringify(row[c])) : row[c]));
}

export async function createBook(db: Db, ownerId: string, input: BookInput): Promise<Book> {
  const cols = WRITE_COLS.join(", ");
  const ph = WRITE_COLS.map((_, i) => (WRITE_COLS[i] === "marc_fields" ? `$${i + 2}::jsonb` : `$${i + 2}`)).join(", ");
  const r = await db.query<BookRow>(`insert into books (owner_id, ${cols}) values ($1, ${ph}) returning ${BOOK_COLUMNS}`, [ownerId, ...writeParams(input)]);
  return rowToBook(r.rows[0]!);
}

export async function updateBook(db: Db, ownerId: string, id: string, input: BookInput): Promise<Book | null> {
  if (!isUuid(id)) return null;
  const sets = WRITE_COLS.map((c, i) => `${c} = $${i + 3}${c === "marc_fields" ? "::jsonb" : ""}`).join(", ");
  const r = await db.query<BookRow>(`update books set ${sets} where owner_id = $1 and id = $2 returning ${BOOK_COLUMNS}`, [ownerId, id, ...writeParams(input)]);
  return r.rows[0] ? rowToBook(r.rows[0]) : null;
}

export async function deleteBook(db: Db, ownerId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await db.query(`delete from books where owner_id = $1 and id = $2 returning id`, [ownerId, id]);
  return r.rowCount > 0;
}

export async function getStats(db: Db, ownerId: string): Promise<CatalogStats> {
  const byStatus = Object.fromEntries(BOOK_STATUSES.map((s) => [s, 0])) as Record<BookStatus, number>;
  const st = await db.query<{ status: BookStatus; n: string }>(`select status, count(*) as n from books where owner_id = $1 group by status`, [ownerId]);
  for (const r of st.rows) byStatus[r.status] = Number(r.n);
  const pub = await db.query<{ n: string }>(`select count(distinct lower(btrim(publisher))) as n from books where owner_id = $1 and publisher is not null`, [ownerId]);
  const sub = await db.query<{ n: string }>(`select count(distinct lower(btrim(s))) as n from books, unnest(subjects) as s where owner_id = $1`, [ownerId]);
  return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus, publishers: Number(pub.rows[0]?.n ?? 0), subjects: Number(sub.rows[0]?.n ?? 0) };
}

export async function listAllBooks(db: Db, ownerId: string): Promise<Book[]> {
  const r = await db.query<BookRow>(`select ${BOOK_COLUMNS} from books where owner_id = $1 order by created_at, id`, [ownerId]);
  return r.rows.map(rowToBook);
}
