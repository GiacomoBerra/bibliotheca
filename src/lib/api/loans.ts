/** Tipi, regole e validazione dei prestiti, condivisi da server e interfaccia. Le date sono stringhe «AAAA-MM-GG» (senza fuso). */

export const LOAN_STATES = ["in prestito", "in ritardo", "restituito"] as const;
export type LoanState = (typeof LOAN_STATES)[number];
/** Disponibilità di un libro: derivata dai prestiti, mai memorizzata. */
export type Availability = "disponibile" | "in prestito" | "restituzione in ritardo";

export const LOAN_LIMITS = { borrower: 200, contact: 200, notes: 1000, minDays: 1, maxDays: 365, defaultDays: 30 } as const;

export interface Loan {
  id: string;
  bookId: string;
  bookTitle: string;
  copyId: string;
  copyNo: number;
  /** null per il visualizzatore: i dati personali sono riservati all'amministratore. */
  borrower: string | null;
  contact: string | null;
  notes: string | null;
  loanDate: string;
  plannedDays: number;
  dueDate: string;
  returnedDate: string | null;
  state: LoanState;
  /** Durata effettiva in giorni (restituzione − inizio), solo se restituito. */
  effectiveDays: number | null;
  /** Giorni di ritardo (rispetto alla data prevista, fino a oggi o alla restituzione); 0 se in regola. */
  daysLate: number;
}

export interface LoanInput { borrower: string; contact: string; loanDate: string; plannedDays: number; notes: string }
export interface LoanEditInput { borrower: string; contact: string; plannedDays: number; notes: string }

export type LoanStateFilter = "attivi" | "in ritardo" | "restituiti" | "tutti";
export interface LoanListOptions { borrower?: string; state?: LoanStateFilter; from?: string; to?: string; bookId?: string; page?: number; pageSize?: number }
export interface LoanPage { items: Loan[]; total: number; page: number; pageSize: number }
export interface BookLoans { availability: Availability; loans: Loan[] }

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}
const toDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;
export function addDays(date: string, days: number): string {
  return new Date((toDay(date) + days) * 86_400_000).toISOString().slice(0, 10);
}
/** Differenza in giorni interi `b − a`. */
export function daysBetween(a: string, b: string): number { return toDay(b) - toDay(a); }

/** Data odierna nel fuso della biblioteca (Europa/Zurigo), come «AAAA-MM-GG». */
export function todayIso(now: Date = new Date(), timeZone = "Europe/Zurich"): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function loanState(l: { dueDate: string; returnedDate: string | null }, today: string): LoanState {
  if (l.returnedDate) return "restituito";
  return daysBetween(l.dueDate, today) > 0 ? "in ritardo" : "in prestito";
}
export function loanDerived(l: { loanDate: string; dueDate: string; returnedDate: string | null }, today: string) {
  const end = l.returnedDate ?? today;
  return {
    state: loanState(l, today),
    effectiveDays: l.returnedDate ? daysBetween(l.loanDate, l.returnedDate) : null,
    daysLate: Math.max(0, daysBetween(l.dueDate, end)),
  };
}
export function availabilityOf(loans: Pick<Loan, "state">[]): Availability {
  if (loans.some((l) => l.state === "in ritardo")) return "restituzione in ritardo";
  if (loans.some((l) => l.state === "in prestito")) return "in prestito";
  return "disponibile";
}

export type FieldErrors = Record<string, string>;
interface RawLoan { borrower?: unknown; contact?: unknown; notes?: unknown; loanDate?: unknown; plannedDays?: unknown; returnedDate?: unknown }
type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : null);

/** Valida i dati di un nuovo prestito (tipi, lunghezze, date). Le regole dipendenti dalla data odierna sono nel repository. */
export function parseLoanInput(raw: unknown): Parsed<LoanInput> {
  const o = (raw && typeof raw === "object" ? raw : {}) as RawLoan;
  const errors: FieldErrors = {};
  const borrower = str(o.borrower), contact = str(o.contact), notes = str(o.notes);
  if (borrower === null || !borrower) errors["borrower"] = "Indica il nome di chi riceve il libro.";
  else if (borrower.length > LOAN_LIMITS.borrower) errors["borrower"] = `Il nome può avere al massimo ${LOAN_LIMITS.borrower} caratteri.`;
  if (contact === null || contact.length > LOAN_LIMITS.contact) errors["contact"] = `Il recapito può avere al massimo ${LOAN_LIMITS.contact} caratteri.`;
  if (notes === null || notes.length > LOAN_LIMITS.notes) errors["notes"] = `Le note possono avere al massimo ${LOAN_LIMITS.notes} caratteri.`;
  if (!isIsoDate(o.loanDate)) errors["loanDate"] = "Indica la data del prestito (formato AAAA-MM-GG).";
  const days = o.plannedDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < LOAN_LIMITS.minDays || days > LOAN_LIMITS.maxDays) errors["plannedDays"] = `La durata prevista deve essere un numero intero di giorni da ${LOAN_LIMITS.minDays} a ${LOAN_LIMITS.maxDays}.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { borrower: borrower!, contact: contact!, loanDate: o.loanDate as string, plannedDays: days as number, notes: notes! } };
}

export function parseLoanEdit(raw: unknown): Parsed<LoanEditInput> {
  const o = (raw && typeof raw === "object" ? raw : {}) as RawLoan;
  const r = parseLoanInput({ ...o, loanDate: "2000-01-01" }); // la data di inizio non è modificabile
  if (!r.ok) return r;
  const { loanDate: _unused, ...value } = r.value;
  void _unused;
  return { ok: true, value };
}

export function parseReturnInput(raw: unknown): Parsed<{ returnedDate: string | null }> {
  const o = (raw && typeof raw === "object" ? raw : {}) as RawLoan;
  if (o.returnedDate == null || o.returnedDate === "") return { ok: true, value: { returnedDate: null } };
  if (!isIsoDate(o.returnedDate)) return { ok: false, errors: { returnedDate: "La data di restituzione non è valida (formato AAAA-MM-GG)." } };
  return { ok: true, value: { returnedDate: o.returnedDate } };
}

export function parseLoanListOptions(q: URLSearchParams): LoanListOptions {
  const o: LoanListOptions = { page: Number(q.get("page") ?? 1), pageSize: Number(q.get("pageSize") ?? 25) };
  const borrower = (q.get("borrower") ?? "").trim().slice(0, 200);
  if (borrower) o.borrower = borrower;
  const s = q.get("state");
  if (s === "attivi" || s === "in ritardo" || s === "restituiti" || s === "tutti") o.state = s;
  const from = q.get("from"), to = q.get("to"), bookId = q.get("bookId");
  if (from && isIsoDate(from)) o.from = from;
  if (to && isIsoDate(to)) o.to = to;
  if (bookId) o.bookId = bookId;
  return o;
}
