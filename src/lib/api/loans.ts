/** Tipi, regole e validazione dei prestiti, condivisi da server e interfaccia. Le date sono stringhe «AAAA-MM-GG» (senza fuso). */

export const LOAN_STATES = ["in prestito", "in ritardo", "restituito", "annullato"] as const;
export type LoanState = (typeof LOAN_STATES)[number];
/** Disponibilità di un libro: derivata dai prestiti, mai memorizzata. */
export type Availability = "disponibile" | "in prestito" | "restituzione in ritardo";

/** Stato di disponibilità di un libro nell'elenco del catalogo (tutte le copie fisiche considerate). */
export const CATALOG_LOAN_STATES = ["disponibile", "in prestito", "in ritardo", "disponibilità parziale"] as const;
export type CatalogLoanState = (typeof CATALOG_LOAN_STATES)[number];
export interface BookAvailability { state: CatalogLoanState; totalCopies: number; availableCopies: number }
/** Filtro per disponibilità del catalogo. */
export const LOAN_FILTERS = ["tutti", "disponibili", "in prestito", "in ritardo", "parziale"] as const;
export type LoanFilter = (typeof LOAN_FILTERS)[number];

/**
 * Regola unica (server, test e interfaccia). `total` = copie fisiche (minimo 1: ogni libro ha almeno una copia, anche
 * se non è mai stata prestata), `active` = copie con un prestito attivo e non annullato, `late` = di queste, quelle con
 * data prevista di restituzione già trascorsa (vedi `loanState`: il giorno stesso della scadenza NON è ancora ritardo).
 * Priorità: in ritardo (almeno una copia scaduta) > disponibilità parziale (alcune copie libere, altre fuori) >
 * in prestito (tutte le copie fuori, nessuna scaduta) > disponibile.
 */
export function summarizeAvailability(total: number, active: number, late: number): BookAvailability {
  const t = Math.max(1, Math.trunc(total) || 1);
  const a = Math.min(Math.max(Math.trunc(active) || 0, 0), t);
  const state: CatalogLoanState = a === 0 ? "disponibile" : late > 0 ? "in ritardo" : a < t ? "disponibilità parziale" : "in prestito";
  return { state, totalCopies: t, availableCopies: t - a };
}

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
  /** Prestito annullato perché registrato per errore: resta nello storico ma non conta come prestito. */
  voidedAt: string | null;
  /** Motivazione dell'annullamento: riservata all'amministratore (null per il visualizzatore). */
  voidReason: string | null;
  /** Chi ha annullato il prestito: riservato all'amministratore (null per il visualizzatore). */
  voidedBy: string | null;
  /** Numero di correzioni registrate su questo prestito (annullamenti di restituzione compresi). */
  correctionCount: number;
}

export type CorrectionAction = "annulla_prestito" | "annulla_restituzione";
export interface LoanCorrectionState {
  state: "attivo" | "restituito" | "annullato"; returnedDate: string | null; returnedBy: string | null; voided: boolean;
  /** Presente quando il prestito annullato è stato ripristinato da un backup: l'annullamento originale. */
  restoredFrom?: { at: string; by: string; reason: string };
}
/** Una riga della traccia delle correzioni (solo amministratori). */
export interface LoanCorrection {
  id: string; loanId: string; action: CorrectionAction; reason: string;
  correctedBy: string; correctedAt: string;
  before: LoanCorrectionState; after: LoanCorrectionState;
}

/** `returnedDate`: solo per registrare un prestito già concluso (ripristino di backup o inserimento a posteriori). */
export interface LoanInput {
  borrower: string; contact: string; loanDate: string; plannedDays: number; notes: string; returnedDate?: string | null;
  /** Solo per il ripristino di un backup: il prestito nasce già annullato, con l'annullamento originale nella traccia. */
  voidedRestore?: { reason: string; originalAt: string; originalBy: string };
}
export interface LoanEditInput { borrower: string; contact: string; plannedDays: number; notes: string }

export type LoanStateFilter = "attivi" | "in ritardo" | "restituiti" | "annullati" | "tutti";
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

export function loanState(l: { dueDate: string; returnedDate: string | null; voidedAt?: string | null }, today: string): LoanState {
  if (l.voidedAt) return "annullato";
  if (l.returnedDate) return "restituito";
  return daysBetween(l.dueDate, today) > 0 ? "in ritardo" : "in prestito";
}
export function loanDerived(l: { loanDate: string; dueDate: string; returnedDate: string | null; voidedAt?: string | null }, today: string) {
  const end = l.returnedDate ?? today;
  const voided = !!l.voidedAt;
  return {
    state: loanState(l, today),
    effectiveDays: l.returnedDate && !voided ? daysBetween(l.loanDate, l.returnedDate) : null,
    daysLate: voided ? 0 : Math.max(0, daysBetween(l.dueDate, end)),
  };
}
export function availabilityOf(loans: Pick<Loan, "state">[]): Availability {
  if (loans.some((l) => l.state === "in ritardo")) return "restituzione in ritardo";
  if (loans.some((l) => l.state === "in prestito")) return "in prestito";
  return "disponibile";
}

export type FieldErrors = Record<string, string>;
interface RawLoan { voidedRestore?: unknown; borrower?: unknown; contact?: unknown; notes?: unknown; loanDate?: unknown; plannedDays?: unknown; returnedDate?: unknown }
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
  const ret = o.returnedDate == null || o.returnedDate === "" ? null : o.returnedDate;
  if (ret !== null && !isIsoDate(ret)) errors["returnedDate"] = "La data di restituzione non è valida (formato AAAA-MM-GG).";
  else if (ret !== null && isIsoDate(o.loanDate) && ret < o.loanDate) errors["returnedDate"] = "La restituzione non può precedere l'inizio del prestito.";
  let voidedRestore: LoanInput["voidedRestore"];
  if (o.voidedRestore != null) {
    const v = o.voidedRestore as { reason?: unknown; originalAt?: unknown; originalBy?: unknown };
    const ok = (x: unknown, max: number): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max;
    if (!v || typeof v !== "object" || !ok(v.reason, REASON_LIMITS.max) || (v.reason as string).trim().length < REASON_LIMITS.min || !ok(v.originalAt, 40) || !ok(v.originalBy, 200)) errors["voidedRestore"] = "I dati dell'annullamento originale non sono validi.";
    else voidedRestore = { reason: (v.reason as string).trim(), originalAt: v.originalAt as string, originalBy: v.originalBy as string };
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { borrower: borrower!, contact: contact!, loanDate: o.loanDate as string, plannedDays: days as number, notes: notes!, ...(ret !== null ? { returnedDate: ret as string } : {}), ...(voidedRestore ? { voidedRestore } : {}) } };
}

export function parseLoanEdit(raw: unknown): Parsed<LoanEditInput> {
  const o = (raw && typeof raw === "object" ? raw : {}) as RawLoan;
  const r = parseLoanInput({ ...o, loanDate: "2000-01-01" }); // la data di inizio non è modificabile
  if (!r.ok) return r;
  const { loanDate: _unused, returnedDate: _r, ...value } = r.value;
  void _r;
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
  if (s === "attivi" || s === "in ritardo" || s === "restituiti" || s === "annullati" || s === "tutti") o.state = s;
  const from = q.get("from"), to = q.get("to"), bookId = q.get("bookId");
  if (from && isIsoDate(from)) o.from = from;
  if (to && isIsoDate(to)) o.to = to;
  if (bookId) o.bookId = bookId;
  return o;
}

export const REASON_LIMITS = { min: 3, max: 500 } as const;
/** Motivazione obbligatoria di una correzione (annullamento di un prestito o di una restituzione). */
export function parseCorrectionInput(raw: unknown): Parsed<{ reason: string }> {
  const o = (raw && typeof raw === "object" ? raw : {}) as { reason?: unknown };
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  if (reason.length < REASON_LIMITS.min) return { ok: false, errors: { reason: `Indica brevemente il motivo della correzione (almeno ${REASON_LIMITS.min} caratteri).` } };
  if (reason.length > REASON_LIMITS.max) return { ok: false, errors: { reason: `Il motivo può avere al massimo ${REASON_LIMITS.max} caratteri.` } };
  return { ok: true, value: { reason } };
}
