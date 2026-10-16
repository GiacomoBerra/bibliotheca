import { BOOK_COLUMNS, bookToRow, escapeLike, rowToBook, searchTerms, type BookRow } from "../src/lib/api/mapping";
import { LOAN_FILTERS, summarizeAvailability, todayIso, type BookAvailability } from "../src/lib/api/loans";
import { BOOK_STATUSES, type Book, type BookInput, type BookPage, type BookStatus, type CatalogStats, type ListOptions, type SortKey } from "../src/lib/api/types";
import type { Db } from "./db";

/**
 * Accesso ai dati. Il catalogo è unico e condiviso: queste funzioni NON decidono chi può fare cosa
 * (lo fa `server/router.ts` con il ruolo verificato). Gli id utente per `created_by`/`updated_by`
 * arrivano solo dalla sessione verificata, mai dal browser.
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

const ACTIVE = `l.book_id = books.id and l.returned_date is null and l.voided_at is null`;
// Copie totali: almeno 1; la copia n. 1 nasce al primo prestito, quindi si considera anche il numero di copia più alto.
const SQL_TOTAL = `greatest(1, (select count(*) from book_copies c where c.book_id = books.id), (select coalesce(max(c.copy_no), 0) from book_copies c where c.book_id = books.id))`;
const SQL_ACTIVE = `(select count(*) from loans l where ${ACTIVE})`;
const sqlLate = (todayParam: string) => `(select count(*) from loans l where ${ACTIVE} and l.due_date < ${todayParam}::date)`;

/** Stato prestito dei libri indicati, con UNA sola query (non una per libro). Solo prestiti attivi e non annullati. */
async function availabilityFor(db: Db, ids: string[], today: string): Promise<Record<string, BookAvailability>> {
  if (ids.length === 0) return {};
  const r = await db.query<{ id: string; total: string; active: string; late: string }>(
    `select id, ${SQL_TOTAL} as total, ${SQL_ACTIVE} as active, ${sqlLate("$2")} as late from books where id = any($1::uuid[])`, [ids, today]);
  return Object.fromEntries(r.rows.map((x) => [x.id, summarizeAvailability(Number(x.total), Number(x.active), Number(x.late))]));
}

export async function listBooks(db: Db, o: ListOptions = {}, today: string = todayIso()): Promise<BookPage> {
  const pageSize = Math.min(Math.max(Math.trunc(o.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), 100);
  const page = Math.max(Math.trunc(o.page ?? 1) || 1, 1);
  const sort: SortKey = o.sort && o.sort in ORDER ? o.sort : "aggiornamento";
  const dir = (o.dir ?? (sort === "aggiornamento" ? "desc" : "asc")) === "desc" ? "desc" : "asc";

  const params: unknown[] = [];
  const where = ["true"];
  for (const term of searchTerms(o.query ?? "")) {
    params.push(`%${escapeLike(term)}%`);
    where.push(`search_text like $${params.length} escape '\\'`);
  }
  if (o.status && o.status !== "tutti" && (BOOK_STATUSES as readonly string[]).includes(o.status)) {
    params.push(o.status);
    where.push(`status = $${params.length}`);
  }
  if (o.loan && (LOAN_FILTERS as readonly string[]).includes(o.loan) && o.loan !== "tutti") {
    // il parametro «oggi» si aggiunge solo quando serve: un parametro non usato fa fallire la query
    const late = () => { params.push(today); return sqlLate(`$${params.length}`); };
    where.push(o.loan === "disponibili" ? `${SQL_ACTIVE} = 0`
      : o.loan === "in ritardo" ? `${late()} > 0`
      : o.loan === "parziale" ? `${late()} = 0 and ${SQL_ACTIVE} > 0 and ${SQL_ACTIVE} < ${SQL_TOTAL}`
      : `${late()} = 0 and ${SQL_ACTIVE} > 0 and ${SQL_ACTIVE} >= ${SQL_TOTAL}`);
  }
  const clause = where.join(" and ");
  const total = Number((await db.query<{ n: string }>(`select count(*) as n from books where ${clause}`, params)).rows[0]?.n ?? 0);
  const rows = await db.query<BookRow>(
    `select ${BOOK_COLUMNS} from books where ${clause} order by ${ORDER[sort]} ${dir} nulls last, id limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  const items = rows.rows.map(rowToBook);
  return { items, total, page, pageSize, availability: await availabilityFor(db, items.map((b) => b.id), today) };
}

export async function getBook(db: Db, id: string): Promise<Book | null> {
  if (!isUuid(id)) return null;
  const r = await db.query<BookRow>(`select ${BOOK_COLUMNS} from books where id = $1`, [id]);
  return r.rows[0] ? rowToBook(r.rows[0]) : null;
}

const WRITE_COLS = ["title", "authors", "isbn", "publisher", "publication_place", "publication_year", "language", "physical_description", "notes", "subjects", "dewey", "dewey_notes", "dewey_source", "shelf_mark", "status", "marc_leader", "marc_fields"] as const;

function writeParams(input: BookInput): unknown[] {
  const row = bookToRow(input) as Record<string, unknown>;
  return WRITE_COLS.map((c) => (c === "marc_fields" ? (row[c] === null ? null : JSON.stringify(row[c])) : row[c]));
}

export async function createBook(db: Db, userId: string, input: BookInput): Promise<Book> {
  const cols = WRITE_COLS.join(", ");
  const ph = WRITE_COLS.map((_, i) => (WRITE_COLS[i] === "marc_fields" ? `$${i + 2}::jsonb` : `$${i + 2}`)).join(", ");
  // Ogni libro nasce con la sua copia n. 1 (stessa istruzione: o entrambi o nessuno).
  const r = await db.query<BookRow>(`with ins as (insert into books (created_by, updated_by, ${cols}) values ($1, $1, ${ph}) returning *), cp as (insert into book_copies (book_id, copy_no) select id, 1 from ins) select ${BOOK_COLUMNS} from ins`, [userId, ...writeParams(input)]);
  return rowToBook(r.rows[0]!);
}

export async function updateBook(db: Db, userId: string, id: string, input: BookInput): Promise<Book | null> {
  if (!isUuid(id)) return null;
  const sets = WRITE_COLS.map((c, i) => `${c} = $${i + 3}${c === "marc_fields" ? "::jsonb" : ""}`).join(", ");
  const r = await db.query<BookRow>(`update books set updated_by = $1, ${sets} where id = $2 returning ${BOOK_COLUMNS}`, [userId, id, ...writeParams(input)]);
  return r.rows[0] ? rowToBook(r.rows[0]) : null;
}

export async function deleteBook(db: Db, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await db.query(`delete from books where id = $1 returning id`, [id]);
  return r.rowCount > 0;
}

export async function getStats(db: Db): Promise<CatalogStats> {
  const byStatus = Object.fromEntries(BOOK_STATUSES.map((s) => [s, 0])) as Record<BookStatus, number>;
  const st = await db.query<{ status: BookStatus; n: string }>(`select status, count(*) as n from books group by status`);
  for (const r of st.rows) byStatus[r.status] = Number(r.n);
  const pub = await db.query<{ n: string }>(`select count(distinct lower(btrim(publisher))) as n from books where publisher is not null`);
  const sub = await db.query<{ n: string }>(`select count(distinct lower(btrim(s))) as n from books, unnest(subjects) as s`);
  return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus, publishers: Number(pub.rows[0]?.n ?? 0), subjects: Number(sub.rows[0]?.n ?? 0) };
}

export async function listAllBooks(db: Db): Promise<Book[]> {
  const r = await db.query<BookRow>(`select ${BOOK_COLUMNS} from books order by created_at, id`);
  return r.rows.map(rowToBook);
}
