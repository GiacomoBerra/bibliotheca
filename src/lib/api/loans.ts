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
  /** Chi ha registrato il prestito / la restituzione e quando: riservati all'amministratore (null per il visualizzatore). */
  createdBy: string | null;
  createdAt: string | null;
  returnedBy: string | null;
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
  const ret = o.returnedDate == null || o.returnedDate === "" ? null : o.returnedDate;
  if (ret !== null && !isIsoDate(ret)) errors["returnedDate"] = "La data di restituzione non è valida (formato AAAA-MM-GG).";
  else if (ret !== null && isIsoDate(o.loanDate) && ret < o.loanDate) errors["returnedDate"] = "La restituzione non può precedere l'inizio del prestito.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { borrower: borrower!, contact: contact!, loanDate: o.loanDate as string, plannedDays: days as number, notes: notes!, ...(ret !== null ? { returnedDate: ret as string } : {}) } };
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


/* ---------- Ripristino integrale della cronologia (backup v4) ---------- */

/** Un prestito con tutta la sua storia, come lo descrive un backup. Il ripristino lo inserisce così com'è, in un colpo solo. */
export interface LoanRestoreRecord {
  /** Identificativo originale (backup v4). Se manca, il server ne genera uno. */
  id?: string;
  /** Identificativo della scheda NEL DATABASE DI DESTINAZIONE. */
  bookId: string;
  copyNo: number;
  borrower: string; contact: string; notes: string;
  loanDate: string; plannedDays: number; returnedDate: string | null;
  /** Autore/data della registrazione e autore della restituzione. Se assenti (backup v2/v3) subentra chi ripristina. */
  createdBy?: string; createdAt?: string; returnedBy?: string;
  voided?: { at: string; by: string; reason: string };
  /** Dalla più vecchia alla più recente. */
  corrections: RestoreCorrection[];
}
export interface RestoreCorrection { action: CorrectionAction; reason: string; correctedBy: string; correctedAt: string; before: LoanCorrectionState; after: LoanCorrectionState }

export const RESTORE_MAX_LOANS = 3000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)) && isIsoDate(v.slice(0, 10));
const txt = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.trim().length >= min && v.length <= max;

function checkState(x: unknown): LoanCorrectionState | null {
  const o = x as Partial<LoanCorrectionState> | null;
  if (!o || typeof o !== "object") return null;
  if (o.state !== "attivo" && o.state !== "restituito" && o.state !== "annullato") return null;
  if (o.returnedDate !== null && !isIsoDate(o.returnedDate)) return null;
  if (o.returnedBy !== null && typeof o.returnedBy !== "string") return null;
  if (typeof o.voided !== "boolean") return null;
  return o as LoanCorrectionState;
}

/**
 * Controlla che la storia di UN prestito sia coerente prima di scriverla: dati validi, correzioni in ordine di tempo,
 * stato annullato dichiarato solo se c'è l'annullamento (ed è l'ultima correzione, con lo stesso autore, data e motivo),
 * un solo annullamento, restituzioni annullate che partono da uno stato «restituito». Ritorna il messaggio d'errore o null.
 */
const ms = (t: string) => Date.parse(t);
export function checkLoanHistory(r: LoanRestoreRecord): string | null {
  if (r.returnedDate !== null && r.returnedDate < r.loanDate) return "la restituzione precede l'inizio del prestito";
  if (r.createdAt && r.corrections[0] && ms(r.corrections[0].correctedAt) < ms(r.createdAt)) return "una correzione precede la registrazione del prestito";
  let prev = -Infinity;
  let voidCount = 0;
  for (const [i, c] of r.corrections.entries()) {
    if (ms(c.correctedAt) < prev) return `le correzioni non sono in ordine cronologico (n. ${i + 1})`;
    prev = ms(c.correctedAt);
    if (c.action === "annulla_restituzione") {
      if (c.before.state !== "restituito" || c.before.returnedDate === null || c.after.state !== "attivo" || c.after.returnedDate !== null) return `la correzione n. ${i + 1} (annullamento di restituzione) non ha stati coerenti`;
      if (voidCount > 0) return `la correzione n. ${i + 1} segue l'annullamento del prestito`;
    } else {
      voidCount++;
      if (c.after.state !== "annullato" || !c.after.voided || c.before.voided) return `la correzione n. ${i + 1} (annullamento del prestito) non ha stati coerenti`;
      if (i !== r.corrections.length - 1) return `l'annullamento del prestito non è l'ultima correzione`;
    }
  }
  const last = r.corrections[r.corrections.length - 1];
  if (r.voided) {
    if (!last || last.action !== "annulla_prestito" || ms(last.correctedAt) !== ms(r.voided.at) || last.correctedBy !== r.voided.by || last.reason !== r.voided.reason) return "il prestito è annullato ma l'ultima correzione non corrisponde all'annullamento";
    if (last.before.returnedDate !== r.returnedDate || last.after.returnedDate !== r.returnedDate) return "lo stato registrato nell'annullamento non coincide con la restituzione del prestito";
  } else if (voidCount > 0) return "c'è un annullamento di prestito nella cronologia ma il prestito non risulta annullato";
  return null;
}

/** Valida l'elenco inviato al ripristino. Un solo errore blocca TUTTO: nulla viene scritto. */
export function parseRestoreInput(raw: unknown): { ok: true; value: LoanRestoreRecord[] } | { ok: false; message: string } {
  const list = (raw && typeof raw === "object" ? (raw as { loans?: unknown }).loans : null);
  if (!Array.isArray(list)) return { ok: false, message: "Manca l'elenco «loans»." };
  if (list.length === 0) return { ok: false, message: "L'elenco dei prestiti da ripristinare è vuoto." };
  if (list.length > RESTORE_MAX_LOANS) return { ok: false, message: `Troppi prestiti in una volta (${list.length}; massimo ${RESTORE_MAX_LOANS}).` };
  const out: LoanRestoreRecord[] = [];
  const ids = new Set<string>();
  for (const [i, x] of list.entries()) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const where = `Prestito ${i + 1}`;
    const bad = (m: string) => ({ ok: false as const, message: `${where}: ${m}.` });
    if (typeof o["bookId"] !== "string" || !UUID_RE.test(o["bookId"])) return bad("scheda non valida");
    if (o["id"] !== undefined && (typeof o["id"] !== "string" || !UUID_RE.test(o["id"]))) return bad("identificativo non valido");
    if (typeof o["id"] === "string") { const k = o["id"].toLowerCase(); if (ids.has(k)) return bad("identificativo ripetuto nel file"); ids.add(k); }
    if (typeof o["copyNo"] !== "number" || !Number.isInteger(o["copyNo"]) || o["copyNo"] < 1 || o["copyNo"] > 999) return bad("numero di copia non valido");
    const borrower = typeof o["borrower"] === "string" ? o["borrower"].trim() : "";
    const contact = typeof o["contact"] === "string" ? o["contact"].trim() : o["contact"] == null ? "" : null;
    const notes = typeof o["notes"] === "string" ? o["notes"].trim() : o["notes"] == null ? "" : null;
    if (!borrower || borrower.length > LOAN_LIMITS.borrower) return bad("destinatario mancante o troppo lungo");
    if (contact === null || contact.length > LOAN_LIMITS.contact) return bad("recapito non valido");
    if (notes === null || notes.length > LOAN_LIMITS.notes) return bad("note non valide");
    if (!isIsoDate(o["loanDate"])) return bad("data del prestito non valida");
    const days = o["plannedDays"];
    if (typeof days !== "number" || !Number.isInteger(days) || days < LOAN_LIMITS.minDays || days > LOAN_LIMITS.maxDays) return bad("durata prevista non valida");
    const ret = o["returnedDate"] ?? null;
    if (ret !== null && !isIsoDate(ret)) return bad("data di restituzione non valida");
    for (const k of ["createdBy", "returnedBy"] as const) if (o[k] != null && !txt(o[k], 1, 200)) return bad(`campo «${k}» non valido`);
    if (o["createdAt"] != null && !isStamp(o["createdAt"])) return bad("data di registrazione non valida");
    if (ret !== null && o["returnedBy"] != null && !txt(o["returnedBy"], 1, 200)) return bad("autore della restituzione non valido");
    let voided: LoanRestoreRecord["voided"];
    if (o["voided"] != null) {
      const v = o["voided"] as Record<string, unknown>;
      if (!v || typeof v !== "object" || !isStamp(v["at"]) || !txt(v["by"], 1, 200) || !txt(v["reason"], REASON_LIMITS.min, REASON_LIMITS.max)) return bad("dati dell'annullamento non validi");
      voided = { at: v["at"] as string, by: v["by"] as string, reason: (v["reason"] as string).trim() };
    }
    const rawC = o["corrections"] ?? [];
    if (!Array.isArray(rawC) || rawC.length > 50) return bad("elenco delle correzioni non valido");
    const corrections: RestoreCorrection[] = [];
    for (const [j, cx] of rawC.entries()) {
      const c = (cx && typeof cx === "object" ? cx : {}) as Record<string, unknown>;
      const before = checkState(c["before"]), after = checkState(c["after"]);
      if (c["action"] !== "annulla_prestito" && c["action"] !== "annulla_restituzione") return bad(`correzione ${j + 1}: azione sconosciuta`);
      if (!txt(c["reason"], REASON_LIMITS.min, REASON_LIMITS.max)) return bad(`correzione ${j + 1}: motivo mancante o non valido`);
      if (!txt(c["correctedBy"], 1, 200)) return bad(`correzione ${j + 1}: autore mancante`);
      if (!isStamp(c["correctedAt"])) return bad(`correzione ${j + 1}: data non valida`);
      if (!before || !after) return bad(`correzione ${j + 1}: stati prima/dopo non validi`);
      corrections.push({ action: c["action"], reason: (c["reason"] as string).trim(), correctedBy: c["correctedBy"] as string, correctedAt: c["correctedAt"] as string, before, after });
    }
    const rec: LoanRestoreRecord = {
      ...(typeof o["id"] === "string" ? { id: o["id"].toLowerCase() } : {}), bookId: o["bookId"].toLowerCase(), copyNo: o["copyNo"],
      borrower, contact, notes, loanDate: o["loanDate"], plannedDays: days, returnedDate: ret as string | null,
      ...(typeof o["createdBy"] === "string" ? { createdBy: o["createdBy"] } : {}), ...(typeof o["createdAt"] === "string" ? { createdAt: o["createdAt"] } : {}),
      ...(typeof o["returnedBy"] === "string" ? { returnedBy: o["returnedBy"] } : {}), ...(voided ? { voided } : {}), corrections,
    };
    const h = checkLoanHistory(rec);
    if (h) return bad(h);
    out.push(rec);
  }
  // Due prestiti attivi sulla stessa copia nello stesso file sono incoerenti.
  const active = new Set<string>();
  for (const r of out) if (r.returnedDate === null && !r.voided) { const k = `${r.bookId}#${r.copyNo}`; if (active.has(k)) return { ok: false, message: `Due prestiti attivi sulla stessa copia (n. ${r.copyNo}) nello stesso file: il ripristino è stato rifiutato.` }; active.add(k); }
  return { ok: true, value: out };
}
