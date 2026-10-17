import type { BookCopy, CopyInput } from "../src/lib/api/loans";
import { COPY_LIMITS } from "../src/lib/api/loans";
import type { Db } from "./db";
import { isUuid } from "./booksRepo";
import { LoanError } from "./loansRepo";

interface CopyRow { id: string; book_id: string; copy_no: number; inventory_code: string | null; notes: string | null; due: string | null }
const SELECT = `select c.id, c.book_id, c.copy_no, c.inventory_code, c.notes,
  (select l.due_date::text from loans l where l.copy_id = c.id and l.returned_date is null and l.voided_at is null) as due
  from book_copies c`;
const pgCode = (e: unknown) => (e as { code?: unknown } | null)?.code;
const pgConstraint = (e: unknown) => String((e as { constraint?: unknown } | null)?.constraint ?? "");

/** Stato di una copia: derivato dal prestito attivo non annullato e dalla data odierna (il giorno di scadenza non è ancora ritardo). */
export function copyState(due: string | null, today: string): BookCopy["state"] {
  return due === null ? "disponibile" : due < today ? "in ritardo" : "in prestito";
}
const toCopy = (r: CopyRow, today: string): BookCopy => ({ id: r.id, bookId: r.book_id, copyNo: Number(r.copy_no), inventoryCode: r.inventory_code, notes: r.notes, state: copyState(r.due, today), dueDate: r.due });

/** Copie del libro, in ordine. Un libro senza righe ha comunque la copia n. 1 (logica, `id: null`) finché non serve altro. */
export async function listCopies(db: Db, bookId: string, today: string): Promise<BookCopy[] | null> {
  if (!isUuid(bookId) || (await db.query(`select 1 from books where id = $1`, [bookId])).rows.length === 0) return null;
  const r = await db.query<CopyRow>(`${SELECT} where c.book_id = $1 order by c.copy_no`, [bookId]);
  if (r.rows.length === 0) return [{ id: null, bookId, copyNo: 1, inventoryCode: null, notes: null, state: "disponibile", dueDate: null }];
  return r.rows.map((x) => toCopy(x, today));
}

/** Tutte le copie (per il backup): una sola query. */
export async function listAllCopies(db: Db, today: string): Promise<BookCopy[]> {
  return (await db.query<CopyRow>(`${SELECT} order by c.book_id, c.copy_no`)).rows.map((x) => toCopy(x, today));
}

function codeClash(): LoanError {
  return new LoanError(409, "duplicate_code", "Questo codice di inventario è già usato da un'altra copia. Scegli un codice diverso: nessuna copia è stata modificata.");
}

/** Aggiunge la copia successiva (numero = massimo + 1). Crea prima la n. 1 se manca. Nessuna copia si cancella mai. */
export async function addCopy(db: Db, bookId: string, input: CopyInput, today: string): Promise<BookCopy> {
  if (!isUuid(bookId) || (await db.query(`select 1 from books where id = $1`, [bookId])).rows.length === 0) throw new LoanError(404, "not_found", "Il libro non esiste più: nessuna copia aggiunta.");
  await db.query(`insert into book_copies (book_id, copy_no) values ($1, 1) on conflict (book_id, copy_no) do nothing`, [bookId]);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // Una sola istruzione. La riga appena inserita non è visibile alle altre parti della stessa query: si rilegge dal RETURNING (una copia nuova non ha prestiti).
      const r = await db.query<CopyRow>(
        `insert into book_copies (book_id, copy_no, inventory_code, notes)
         select $1, coalesce(max(copy_no), 0) + 1, nullif(btrim($2), ''), nullif(btrim($3), '') from book_copies where book_id = $1
         returning id, book_id, copy_no, inventory_code, notes, null::text as due`,
        [bookId, input.inventoryCode, input.notes],
      );
      const row = r.rows[0];
      if (row) {
        if (Number(row.copy_no) > COPY_LIMITS.max) throw new LoanError(409, "too_many", "Troppe copie per questo libro.");
        return toCopy(row, today);
      }
    } catch (e) {
      if (pgCode(e) === "23505") { if (pgConstraint(e).includes("inventory_code")) throw codeClash(); continue; } // numero di copia preso da una richiesta simultanea: riprova
      if (pgCode(e) === "23514") throw new LoanError(409, "too_many", "Troppe copie per questo libro (massimo 999).");
      throw e;
    }
  }
  throw new LoanError(409, "busy", "Più richieste simultanee hanno impedito di aggiungere la copia: riprova. Nessuna copia è stata aggiunta.");
}

/** Corregge codice di inventario e note di una copia (il numero di copia non cambia). */
export async function updateCopy(db: Db, copyId: string, input: CopyInput, today: string): Promise<BookCopy> {
  if (!isUuid(copyId)) throw new LoanError(404, "not_found", "Copia non trovata.");
  try {
    const r = await db.query<{ id: string }>(`update book_copies set inventory_code = nullif(btrim($2), ''), notes = nullif(btrim($3), '') where id = $1 returning id`, [copyId, input.inventoryCode, input.notes]);
    if (r.rows.length === 0) throw new LoanError(404, "not_found", "Copia non trovata.");
  } catch (e) {
    if (pgCode(e) === "23505") throw codeClash();
    throw e;
  }
  return toCopy((await db.query<CopyRow>(`${SELECT} where c.id = $1`, [copyId])).rows[0]!, today);
}
