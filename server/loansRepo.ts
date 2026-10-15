import { availabilityOf, daysBetween, isIsoDate, loanDerived, type BookLoans, type Loan, type LoanEditInput, type LoanInput, type LoanListOptions, type LoanPage } from "../src/lib/api/loans";
import { escapeLike } from "../src/lib/api/mapping";
import type { Db } from "./db";
import { isUuid } from "./booksRepo";

/** Errore di regola di business, con stato HTTP e messaggio già pronto per l'utente. */
export class LoanError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string, message: string, readonly fields?: Record<string, string>) {
    super(message);
    this.name = "LoanError";
  }
}

interface LoanRow {
  id: string; book_id: string; book_title: string; copy_id: string; copy_no: number;
  borrower_name: string; contact: string | null; notes: string | null;
  loan_date: string; planned_days: number; due_date: string; returned_date: string | null;
}
const SELECT = `select l.id, l.book_id, b.title as book_title, l.copy_id, c.copy_no, l.borrower_name, l.contact, l.notes,
  l.loan_date::text as loan_date, l.planned_days, l.due_date::text as due_date, l.returned_date::text as returned_date
  from loans l join books b on b.id = l.book_id join book_copies c on c.id = l.copy_id`;

/** `redact`: il visualizzatore non riceve nome, recapito e note di chi ha preso in prestito. */
function toLoan(r: LoanRow, today: string, redact: boolean): Loan {
  return {
    id: r.id, bookId: r.book_id, bookTitle: r.book_title, copyId: r.copy_id, copyNo: Number(r.copy_no),
    borrower: redact ? null : r.borrower_name, contact: redact ? null : r.contact, notes: redact ? null : r.notes,
    loanDate: r.loan_date, plannedDays: Number(r.planned_days), dueDate: r.due_date, returnedDate: r.returned_date,
    ...loanDerived({ loanDate: r.loan_date, dueDate: r.due_date, returnedDate: r.returned_date }, today),
  };
}

const pgCode = (e: unknown) => (e as { code?: unknown } | null)?.code;

export async function listBookLoans(db: Db, bookId: string, today: string, redact: boolean): Promise<BookLoans | null> {
  if (!isUuid(bookId)) return null;
  const b = await db.query(`select 1 from books where id = $1`, [bookId]);
  if (b.rows.length === 0) return null;
  const r = await db.query<LoanRow>(`${SELECT} where l.book_id = $1 order by l.loan_date desc, l.created_at desc, l.id`, [bookId]);
  const loans = r.rows.map((x) => toLoan(x, today, redact));
  return { availability: availabilityOf(loans), loans };
}

export async function listLoans(db: Db, o: LoanListOptions, today: string): Promise<LoanPage> {
  const pageSize = Math.min(Math.max(Math.trunc(o.pageSize ?? 25) || 25, 1), 100);
  const page = Math.max(Math.trunc(o.page ?? 1) || 1, 1);
  const params: unknown[] = [];
  const where = ["true"];
  if (o.borrower) { params.push(`%${escapeLike(o.borrower.toLowerCase())}%`); where.push(`lower(l.borrower_name) like $${params.length} escape '\\'`); }
  if (o.bookId) { if (!isUuid(o.bookId)) return { items: [], total: 0, page, pageSize }; params.push(o.bookId); where.push(`l.book_id = $${params.length}`); }
  if (o.from && isIsoDate(o.from)) { params.push(o.from); where.push(`l.loan_date >= $${params.length}::date`); }
  if (o.to && isIsoDate(o.to)) { params.push(o.to); where.push(`l.loan_date <= $${params.length}::date`); }
  if (o.state === "attivi") where.push("l.returned_date is null");
  else if (o.state === "restituiti") where.push("l.returned_date is not null");
  else if (o.state === "in ritardo") { params.push(today); where.push(`l.returned_date is null and l.due_date < $${params.length}::date`); }
  const clause = where.join(" and ");
  const total = Number((await db.query<{ n: string }>(`select count(*) as n from loans l where ${clause}`, params)).rows[0]?.n ?? 0);
  const rows = await db.query<LoanRow>(`${SELECT} where ${clause} order by (l.returned_date is null) desc, l.due_date asc, l.loan_date desc, l.id limit ${pageSize} offset ${(page - 1) * pageSize}`, params);
  return { items: rows.rows.map((r) => toLoan(r, today, false)), total, page, pageSize };
}

async function getLoanRow(db: Db, id: string): Promise<LoanRow | null> {
  if (!isUuid(id)) return null;
  return (await db.query<LoanRow>(`${SELECT} where l.id = $1`, [id])).rows[0] ?? null;
}
export async function getLoan(db: Db, id: string, today: string): Promise<Loan | null> {
  const r = await getLoanRow(db, id);
  return r ? toLoan(r, today, false) : null;
}

/** Registra un prestito sulla copia n. 1 del libro (creata se manca). Rifiuta date incoerenti e prestiti già in corso. */
export async function createLoan(db: Db, userId: string, bookId: string, input: LoanInput, today: string, copyNo = 1): Promise<Loan> {
  if (!isUuid(bookId) || (await db.query(`select 1 from books where id = $1`, [bookId])).rows.length === 0) throw new LoanError(404, "not_found", "Il libro non esiste più: nessun prestito registrato.");
  if (input.loanDate > today) throw new LoanError(400, "validation", "La data del prestito non può essere futura.", { loanDate: "La data del prestito non può essere futura." });

  if (input.returnedDate && input.returnedDate > today) throw new LoanError(400, "validation", "La data di restituzione non può essere futura.", { returnedDate: "La data di restituzione non può essere futura." });
  await db.query(`insert into book_copies (book_id, copy_no) values ($1, $2) on conflict (book_id, copy_no) do nothing`, [bookId, copyNo]);
  const copy = (await db.query<{ id: string }>(`select id from book_copies where book_id = $1 and copy_no = $2`, [bookId, copyNo])).rows[0];
  if (!copy) throw new LoanError(404, "not_found", "Copia non trovata.");
  try {
    const r = await db.query<{ id: string }>(
      `insert into loans (book_id, copy_id, borrower_name, contact, loan_date, planned_days, due_date, notes, created_by, returned_date, returned_by)
       values ($1, $2, $3, $4, $5::date, $6, $5::date + $6::int, $7, $8, $9::date, $10) returning id`,
      [bookId, copy.id, input.borrower, input.contact || null, input.loanDate, input.plannedDays, input.notes || null, userId, input.returnedDate ?? null, input.returnedDate ? userId : null],
    );
    return (await getLoan(db, r.rows[0]!.id, today))!;
  } catch (e) {
    if (pgCode(e) === "23505") throw new LoanError(409, "already_on_loan", "Questa copia risulta già in prestito: registra prima la restituzione. Nessun nuovo prestito è stato salvato.");
    throw e;
  }
}

/** Registra la restituzione: scrive la data effettiva e NON cancella né altera gli altri dati del prestito. */
export async function returnLoan(db: Db, userId: string, id: string, returnedDate: string | null, today: string): Promise<Loan> {
  const cur = await getLoanRow(db, id);
  if (!cur) throw new LoanError(404, "not_found", "Prestito non trovato.");
  if (cur.returned_date) throw new LoanError(409, "already_returned", `Questo prestito è già stato restituito il ${cur.returned_date}. La restituzione registrata non è stata modificata.`);
  const date = returnedDate ?? today;
  if (date > today) throw new LoanError(400, "validation", "La data di restituzione non può essere futura.", { returnedDate: "La data di restituzione non può essere futura." });
  if (daysBetween(cur.loan_date, date) < 0) throw new LoanError(400, "validation", `La restituzione non può precedere l'inizio del prestito (${cur.loan_date}).`, { returnedDate: `La restituzione non può precedere l'inizio del prestito (${cur.loan_date}).` });
  const r = await db.query(`update loans set returned_date = $2::date, returned_by = $3 where id = $1 and returned_date is null returning id`, [id, date, userId]);
  if (r.rowCount === 0) throw new LoanError(409, "already_returned", "Questo prestito è già stato restituito: nessuna modifica.");
  return (await getLoan(db, id, today))!;
}

/** Corregge destinatario, recapito, note e durata prevista (la data di inizio e l'eventuale restituzione non cambiano). */
export async function updateLoan(db: Db, id: string, input: LoanEditInput, today: string): Promise<Loan> {
  const cur = await getLoanRow(db, id);
  if (!cur) throw new LoanError(404, "not_found", "Prestito non trovato.");
  await db.query(
    `update loans set borrower_name = $2, contact = $3, notes = $4, planned_days = $5, due_date = loan_date + $5::int where id = $1`,
    [id, input.borrower, input.contact || null, input.notes || null, input.plannedDays],
  );
  return (await getLoan(db, id, today))!;
}

