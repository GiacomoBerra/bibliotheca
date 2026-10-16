import { availabilityOf, daysBetween, isIsoDate, loanDerived, type BookLoans, type CorrectionAction, type Loan, type LoanCorrection, type LoanCorrectionState, type LoanEditInput, type LoanInput, type LoanListOptions, type LoanPage, type LoanRestoreRecord } from "../src/lib/api/loans";
import { escapeLike } from "../src/lib/api/mapping";
import { randomUUID } from "node:crypto";
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
  voided_at: string | null; void_reason: string | null; voided_by: string | null; correction_count: number | string;
  created_by: string; created_at: string; returned_by: string | null;
}
const SELECT = `select l.id, l.book_id, b.title as book_title, l.copy_id, c.copy_no, l.borrower_name, l.contact, l.notes,
  l.loan_date::text as loan_date, l.planned_days, l.due_date::text as due_date, l.returned_date::text as returned_date,
  to_char(l.voided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as voided_at, l.void_reason, l.voided_by,
  l.created_by, to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, l.returned_by,
  (select count(*) from loan_corrections k where k.loan_id = l.id) as correction_count
  from loans l join books b on b.id = l.book_id join book_copies c on c.id = l.copy_id`;

/** `redact`: il visualizzatore non riceve nome, recapito e note di chi ha preso in prestito. */
function toLoan(r: LoanRow, today: string, redact: boolean): Loan {
  return {
    id: r.id, bookId: r.book_id, bookTitle: r.book_title, copyId: r.copy_id, copyNo: Number(r.copy_no),
    borrower: redact ? null : r.borrower_name, contact: redact ? null : r.contact, notes: redact ? null : r.notes,
    loanDate: r.loan_date, plannedDays: Number(r.planned_days), dueDate: r.due_date, returnedDate: r.returned_date,
    voidedAt: r.voided_at, voidReason: redact ? null : r.void_reason, voidedBy: redact ? null : r.voided_by, correctionCount: Number(r.correction_count),
    createdBy: redact ? null : r.created_by, createdAt: redact ? null : r.created_at, returnedBy: redact ? null : r.returned_by,
    ...loanDerived({ loanDate: r.loan_date, dueDate: r.due_date, returnedDate: r.returned_date, voidedAt: r.voided_at }, today),
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
  if (o.state === "attivi") where.push("l.returned_date is null and l.voided_at is null");
  else if (o.state === "restituiti") where.push("l.returned_date is not null and l.voided_at is null");
  else if (o.state === "annullati") where.push("l.voided_at is not null");
  else if (o.state === "in ritardo") { params.push(today); where.push(`l.returned_date is null and l.voided_at is null and l.due_date < $${params.length}::date`); }
  const clause = where.join(" and ");
  const total = Number((await db.query<{ n: string }>(`select count(*) as n from loans l where ${clause}`, params)).rows[0]?.n ?? 0);
  const rows = await db.query<LoanRow>(`${SELECT} where ${clause} order by (l.returned_date is null and l.voided_at is null) desc, l.due_date asc, l.loan_date desc, l.id limit ${pageSize} offset ${(page - 1) * pageSize}`, params);
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
  if (cur.voided_at) throw new LoanError(409, "voided", "Questo prestito è stato annullato perché registrato per errore: non si può registrare una restituzione.");
  if (cur.returned_date) throw new LoanError(409, "already_returned", `Questo prestito è già stato restituito il ${cur.returned_date}. La restituzione registrata non è stata modificata.`);
  const date = returnedDate ?? today;
  if (date > today) throw new LoanError(400, "validation", "La data di restituzione non può essere futura.", { returnedDate: "La data di restituzione non può essere futura." });
  if (daysBetween(cur.loan_date, date) < 0) throw new LoanError(400, "validation", `La restituzione non può precedere l'inizio del prestito (${cur.loan_date}).`, { returnedDate: `La restituzione non può precedere l'inizio del prestito (${cur.loan_date}).` });
  const r = await db.query(`update loans set returned_date = $2::date, returned_by = $3 where id = $1 and returned_date is null and voided_at is null returning id`, [id, date, userId]);
  if (r.rowCount === 0) throw new LoanError(409, "already_returned", "Questo prestito è già stato restituito: nessuna modifica.");
  return (await getLoan(db, id, today))!;
}

/** Corregge destinatario, recapito, note e durata prevista (la data di inizio e l'eventuale restituzione non cambiano). */
export async function updateLoan(db: Db, id: string, input: LoanEditInput, today: string): Promise<Loan> {
  const cur = await getLoanRow(db, id);
  if (!cur) throw new LoanError(404, "not_found", "Prestito non trovato.");
  if (cur.voided_at) throw new LoanError(409, "voided", "Questo prestito è stato annullato: i suoi dati non si modificano più.");
  await db.query(
    `update loans set borrower_name = $2, contact = $3, notes = $4, planned_days = $5, due_date = loan_date + $5::int where id = $1`,
    [id, input.borrower, input.contact || null, input.notes || null, input.plannedDays],
  );
  return (await getLoan(db, id, today))!;
}


/* ---------- Correzioni ---------- */

/**
 * Annulla un prestito registrato per errore. NON cancella nulla: marca il prestito come annullato (data, autore, motivo)
 * e aggiunge una riga alla traccia. Aggiornamento e traccia sono UNA sola istruzione SQL, quindi atomici: o ci sono
 * entrambi o non cambia niente. Se il prestito era attivo, la copia torna disponibile (l'indice univoco ignora gli annullati).
 */
export async function voidLoan(db: Db, userId: string, id: string, reason: string, today: string): Promise<Loan> {
  if (!isUuid(id)) throw new LoanError(404, "not_found", "Prestito non trovato.");
  const r = await db.query(
    `with cur as (select id, returned_date::text as rd, returned_by as rb from loans where id = $1),
          upd as (update loans set voided_at = now(), voided_by = $2, void_reason = $3 where id = $1 and voided_at is null returning id)
     insert into loan_corrections (loan_id, action, reason, corrected_by, before_state, after_state)
     select u.id, 'annulla_prestito', $3, $2,
            jsonb_build_object('state', case when c.rd is null then 'attivo' else 'restituito' end, 'returnedDate', c.rd, 'returnedBy', c.rb, 'voided', false),
            jsonb_build_object('state', 'annullato', 'returnedDate', c.rd, 'returnedBy', c.rb, 'voided', true)
     from upd u join cur c on c.id = u.id returning loan_id`,
    [id, userId, reason],
  );
  if (r.rows.length === 0) {
    const cur = await getLoanRow(db, id);
    if (!cur) throw new LoanError(404, "not_found", "Prestito non trovato.");
    throw new LoanError(409, "already_voided", "Questo prestito risulta già annullato: nessuna modifica.");
  }
  return (await getLoan(db, id, today))!;
}

/**
 * Annulla la registrazione di una restituzione: il prestito torna attivo. Consentito solo se la copia non è già stata
 * prestata di nuovo (o ha prestiti successivi non annullati) e se il prestito non è annullato. Atomica come `voidLoan`.
 */
export async function undoReturn(db: Db, userId: string, id: string, reason: string, today: string): Promise<Loan> {
  if (!isUuid(id)) throw new LoanError(404, "not_found", "Prestito non trovato.");
  const later = `exists (select 1 from loans o where o.copy_id = l.copy_id and o.id <> l.id and o.voided_at is null and o.loan_date >= l.loan_date)`;
  try {
    const r = await db.query(
      `with cur as (select id, returned_date::text as rd, returned_by as rb from loans where id = $1),
            upd as (update loans l set returned_date = null, returned_by = null
                    where l.id = $1 and l.voided_at is null and l.returned_date is not null and not ${later} returning l.id)
       insert into loan_corrections (loan_id, action, reason, corrected_by, before_state, after_state)
       select u.id, 'annulla_restituzione', $3, $2,
              jsonb_build_object('state', 'restituito', 'returnedDate', c.rd, 'returnedBy', c.rb, 'voided', false),
              jsonb_build_object('state', 'attivo', 'returnedDate', null, 'returnedBy', null, 'voided', false)
       from upd u join cur c on c.id = u.id returning loan_id`,
      [id, userId, reason],
    );
    if (r.rows.length > 0) return (await getLoan(db, id, today))!;
  } catch (e) {
    if (pgCode(e) === "23505") throw new LoanError(409, "already_on_loan", "La copia risulta già in prestito a qualcun altro: la restituzione non è stata annullata. Registra prima la restituzione dell'altro prestito.");
    throw e;
  }
  // Nessuna riga modificata: spiega perché (e non è cambiato nulla).
  const cur = await getLoanRow(db, id);
  if (!cur) throw new LoanError(404, "not_found", "Prestito non trovato.");
  if (cur.voided_at) throw new LoanError(409, "voided", "Questo prestito è stato annullato: non c'è una restituzione da annullare.");
  if (!cur.returned_date) throw new LoanError(409, "not_returned", "Questo prestito non risulta restituito: non c'è nessuna restituzione da annullare.");
  const next = (await db.query<{ borrower_name: string; loan_date: string; returned_date: string | null }>(
    `select o.borrower_name, o.loan_date::text as loan_date, o.returned_date::text as returned_date from loans o
     where o.copy_id = $1 and o.id <> $2 and o.voided_at is null and o.loan_date >= $3::date order by o.loan_date limit 1`, [cur.copy_id, id, cur.loan_date])).rows[0];
  throw new LoanError(409, "later_loan", next
    ? `Non si può annullare la restituzione: la copia è stata prestata di nuovo (dal ${next.loan_date}${next.returned_date ? ", già restituita" : ", ancora in prestito"}). Se anche quel prestito è stato registrato per errore, annullalo prima; altrimenti la restituzione resta valida.`
    : "Non si può annullare la restituzione perché esistono prestiti successivi sulla stessa copia.");
}

interface CorrectionRow { id: string; loan_id: string; action: CorrectionAction; reason: string; corrected_by: string; corrected_at: string; before_state: LoanCorrectionState; after_state: LoanCorrectionState }
export async function listCorrections(db: Db, loanId: string): Promise<LoanCorrection[] | null> {
  if (!isUuid(loanId) || (await db.query(`select 1 from loans where id = $1`, [loanId])).rows.length === 0) return null;
  const r = await db.query<CorrectionRow>(
    `select id, loan_id, action, reason, corrected_by, to_char(corrected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as corrected_at, before_state, after_state
     from loan_corrections where loan_id = $1 order by seq desc`, [loanId]);
  return r.rows.map((x) => ({ id: x.id, loanId: x.loan_id, action: x.action, reason: x.reason, correctedBy: x.corrected_by, correctedAt: x.corrected_at, before: x.before_state, after: x.after_state }));
}


/**
 * Ripristina da un backup una serie di prestiti CON tutta la loro cronologia di correzioni, in UNA sola istruzione SQL:
 * o entra tutto o non cambia nulla (nessun prestito a metà, nessuna correzione orfana). Conserva autore e date originali;
 * registra in `restored_at/restored_by` chi ha eseguito il ripristino. Non cancella e non modifica nulla di esistente:
 * un prestito con lo stesso identificativo già presente viene saltato (esecuzioni ripetute = nessun duplicato).
 * Le copie fisiche mancanti vengono create nella stessa istruzione.
 */
export async function restoreLoans(db: Db, userId: string, records: LoanRestoreRecord[]): Promise<{ received: number; created: number; skipped: number; corrections: number }> {
  const payload = records.map((r) => ({ ...r, id: r.id ?? randomUUID() }));
  try {
    const res = await db.query<{ loans: number | string; corrections: number | string }>(
      `with src as (select e.value as r, e.ord as i from jsonb_array_elements($1::jsonb) with ordinality as e(value, ord)),
            copies as (
              insert into book_copies (book_id, copy_no)
              select distinct (r->>'bookId')::uuid, (r->>'copyNo')::int from src
              on conflict (book_id, copy_no) do update set copy_no = excluded.copy_no
              returning id, book_id, copy_no),
            ins as (
              insert into loans (id, book_id, copy_id, borrower_name, contact, loan_date, planned_days, due_date, notes, created_by, created_at,
                                 returned_date, returned_by, voided_at, voided_by, void_reason, restored_at, restored_by)
              select (s.r->>'id')::uuid, c.book_id, c.id, s.r->>'borrower', nullif(s.r->>'contact', ''), (s.r->>'loanDate')::date, (s.r->>'plannedDays')::int,
                     (s.r->>'loanDate')::date + (s.r->>'plannedDays')::int, nullif(s.r->>'notes', ''),
                     coalesce(s.r->>'createdBy', $2), coalesce((s.r->>'createdAt')::timestamptz, now()),
                     (s.r->>'returnedDate')::date, case when s.r->>'returnedDate' is null then null else coalesce(s.r->>'returnedBy', $2) end,
                     (s.r->'voided'->>'at')::timestamptz, s.r->'voided'->>'by', s.r->'voided'->>'reason', now(), $2
              from src s join copies c on c.book_id = (s.r->>'bookId')::uuid and c.copy_no = (s.r->>'copyNo')::int
              order by s.i
              on conflict (id) do nothing
              returning id),
            cor as (
              insert into loan_corrections (loan_id, action, reason, corrected_by, corrected_at, before_state, after_state, restored_at, restored_by)
              select (s.r->>'id')::uuid, k.value->>'action', k.value->>'reason', k.value->>'correctedBy', (k.value->>'correctedAt')::timestamptz,
                     k.value->'before', k.value->'after', now(), $2
              from src s join ins on ins.id = (s.r->>'id')::uuid
              cross join lateral jsonb_array_elements(coalesce(s.r->'corrections', '[]'::jsonb)) with ordinality as k(value, kord)
              order by s.i, k.kord
              returning 1)
       select (select count(*) from ins) as loans, (select count(*) from cor) as corrections`,
      [JSON.stringify(payload), userId],
    );
    const created = Number(res.rows[0]?.loans ?? 0);
    return { received: records.length, created, skipped: records.length - created, corrections: Number(res.rows[0]?.corrections ?? 0) };
  } catch (e) {
    if (pgCode(e) === "23505") throw new LoanError(409, "already_on_loan", "Una copia del file risulta già in prestito nel database a un altro destinatario. Ripristino annullato: non è stato scritto nulla. Registra prima la restituzione del prestito in corso o escludi quel prestito.");
    if (pgCode(e) === "23503") throw new LoanError(404, "not_found", "Una delle schede indicate non esiste nel database. Ripristino annullato: non è stato scritto nulla.");
    if (pgCode(e) === "23514" || pgCode(e) === "22007" || pgCode(e) === "22008") throw new LoanError(400, "validation", "Il database ha rifiutato i dati di un prestito (vincolo non rispettato). Ripristino annullato: non è stato scritto nulla.");
    throw e;
  }
}
