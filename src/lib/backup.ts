import { parseBookInput } from "./api/parse";
import type { Book, BookInput, BooksApi } from "./api/types";
import { isIsoDate, type Loan, type LoanCorrection } from "./api/loans";
import { BACKUP_FORMAT, type BackupCorrection, type BackupLoan } from "./export";

/**
 * Ripristino da un backup JSON creato da Bibliotheca. Principi:
 * - il file non è fidato: ogni scheda passa dalla STESSA validazione del server (`parseBookInput`);
 * - il ripristino NON cancella mai nulla: crea schede nuove o, solo se l'utente lo sceglie, aggiorna quelle esistenti;
 * - i conflitti si mostrano prima e si risolvono uno per uno;
 * - le scritture avvengono con le API normali (che verificano il ruolo admin lato server).
 */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_VERSIONS = [1, 2, 3];

export interface RecordIssue { index: number; title: string; errors: string[] }
export interface BackupItem { index: number; id?: string; input: BookInput; /** Cose da controllare (non bloccanti). */ notes?: string[] }
export type ParsedBackup =
  | { ok: false; message: string }
  | { ok: true; exportedAt?: string; declaredCount: number | null; items: BackupItem[]; issues: RecordIssue[]; warnings: string[]; version?: number; loans?: BackupLoan[]; loanIssues?: string[]; corrections?: BackupCorrection[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, message: "Il file è troppo grande (massimo 20 MB)." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, message: "Il file non è un JSON valido: potrebbe essere danneggiato o non essere un backup di Bibliotheca. Nulla è stato modificato." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "Il file non ha la struttura di un backup di Bibliotheca." };
  const o = raw as Record<string, unknown>;
  if (o["format"] !== BACKUP_FORMAT) return { ok: false, message: "Il file non è un backup di Bibliotheca (campo «format» mancante o diverso). Un CSV o un altro formato non può essere ripristinato da qui." };
  if (typeof o["version"] !== "number" || !SUPPORTED_VERSIONS.includes(o["version"])) return { ok: false, message: `Versione del backup non supportata (${String(o["version"])}). Versioni gestite: ${SUPPORTED_VERSIONS.join(", ")}.` };
  if (!Array.isArray(o["books"])) return { ok: false, message: "Il backup non contiene l'elenco «books»." };
  const items: BackupItem[] = [];
  const issues: RecordIssue[] = [];
  const warnings: string[] = [];
  o["books"].forEach((b, index) => {
    const parsed = parseBookInput(b);
    const title = b && typeof b === "object" && typeof (b as { title?: unknown }).title === "string" ? (b as { title: string }).title : "(senza titolo)";
    if (!parsed.ok) {
      const e = parsed.errors as Record<string, string>;
      issues.push({ index, title, errors: Object.values(e).filter((x): x is string => typeof x === "string") });
      return;
    }
    const id = (b as { id?: unknown }).id;
    items.push({ index, ...(typeof id === "string" && UUID.test(id) ? { id: id.toLowerCase() } : {}), input: parsed.input });
  });
  const declared = typeof o["count"] === "number" ? o["count"] : null;
  if (declared !== null && declared !== o["books"].length) warnings.push(`Il file dichiara ${declared} schede ma ne contiene ${o["books"].length}: potrebbe essere incompleto.`);
  const out: ParsedBackup = { ok: true, ...(typeof o["exportedAt"] === "string" ? { exportedAt: o["exportedAt"] } : {}), declaredCount: declared, items, issues, warnings, version: o["version"] };
  if (o["version"] === 1) warnings.push("Backup di versione 1: contiene solo le schede, NON copie fisiche né prestiti.");
  if (o["version"] === 2 || o["version"] === 3) {
    const { loans, issues: loanIssues } = parseBackupLoans(o["loans"], o["version"] === 3);
    out.loans = loans;
    out.loanIssues = loanIssues;
    const declaredLoans = typeof o["loanCount"] === "number" ? o["loanCount"] : null;
    if (declaredLoans !== null && Array.isArray(o["loans"]) && declaredLoans !== o["loans"].length) warnings.push(`Il file dichiara ${declaredLoans} prestiti ma ne contiene ${o["loans"].length}: potrebbe essere incompleto.`);
  }
  if (o["version"] === 2) warnings.push("Backup di versione 2: i prestiti annullati per errore e la cronologia delle correzioni non sono inclusi nel file.");
  if (o["version"] === 3) {
    const corr = Array.isArray(o["corrections"]) ? (o["corrections"] as unknown[]).filter((c): c is BackupCorrection => !!c && typeof c === "object" && typeof (c as BackupCorrection).reason === "string" && typeof (c as BackupCorrection).bookId === "string") : [];
    out.corrections = corr;
    const declaredCorr = typeof o["correctionCount"] === "number" ? o["correctionCount"] : null;
    if (declaredCorr !== null && declaredCorr !== corr.length) warnings.push(`Il file dichiara ${declaredCorr} correzioni ma ne contiene ${corr.length}: potrebbe essere incompleto.`);
    if (corr.length > 0) warnings.push(`Il file contiene ${corr.length} correzioni di cronologia: le registrazioni annullate si ripristinano come annullate, con una nota di tracciamento; il dettaglio completo resta nel file.`);
  }
  return out;
}

function parseBackupLoans(raw: unknown, allowVoided: boolean): { loans: BackupLoan[]; issues: string[] } {
  if (!Array.isArray(raw)) return { loans: [], issues: ["Backup senza l'elenco «loans»."] };
  const loans: BackupLoan[] = [];
  const issues: string[] = [];
  raw.forEach((x, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : null);
    const borrower = str(o["borrower"]), contact = str(o["contact"]), notes = str(o["notes"]);
    const days = o["plannedDays"], copyNo = o["copyNo"];
    const ret = o["returnedDate"] ?? null;
    const vv = allowVoided && o["voided"] && typeof o["voided"] === "object" ? (o["voided"] as Record<string, unknown>) : null;
    const voided = vv && typeof vv["at"] === "string" && typeof vv["reason"] === "string" && vv["reason"].trim().length >= 3 && vv["reason"].length <= 500 ? { at: vv["at"], by: typeof vv["by"] === "string" ? vv["by"] : "", reason: vv["reason"].trim() } : null;
    const err =
      o["voided"] != null && !voided ? "dati dell'annullamento non validi" :
      typeof o["bookId"] !== "string" || !o["bookId"] ? "manca il collegamento al libro" :
      !borrower ? "nome del destinatario mancante" : borrower.length > 200 ? "nome troppo lungo" :
      contact === null || contact.length > 200 ? "recapito non valido" : notes === null || notes.length > 1000 ? "note non valide" :
      !isIsoDate(o["loanDate"]) ? "data del prestito non valida" :
      typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365 ? "durata prevista non valida" :
      ret !== null && !isIsoDate(ret) ? "data di restituzione non valida" :
      ret !== null && (ret as string) < (o["loanDate"] as string) ? "restituzione precedente all'inizio del prestito" :
      typeof copyNo !== "number" || !Number.isInteger(copyNo) || copyNo < 1 ? "numero di copia non valido" : null;
    if (err) { issues.push(`Prestito ${i + 1}${typeof o["bookTitle"] === "string" ? ` («${o["bookTitle"]}»)` : ""}: ${err}.`); return; }
    loans.push({ bookId: o["bookId"] as string, bookTitle: typeof o["bookTitle"] === "string" ? o["bookTitle"] : "", copyNo: copyNo as number, borrower: borrower!, contact: contact!, notes: notes!, loanDate: o["loanDate"] as string, plannedDays: days as number, dueDate: typeof o["dueDate"] === "string" ? o["dueDate"] : "", returnedDate: ret as string | null, ...(voided ? { voided } : {}) });
  });
  return { loans, issues };
}

export type Resolution = "crea" | "aggiorna" | "salta";
export type Relation = "nuova" | "stesso-id" | "stesso-isbn" | "stesso-titolo-autore" | "duplicato-nel-file";
export interface PlanItem {
  item: BackupItem;
  relation: Relation;
  /** scheda esistente corrispondente (per «aggiorna») */
  match?: { id: string; title: string };
  resolution: Resolution;
}

const bare = (s: string) => s.replace(/[-\s]/g, "").toLowerCase();
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
const key = (b: BookInput) => `${norm(b.title)}|${norm(b.authors[0] ?? "")}`;

export function relationLabel(r: Relation): string {
  return { nuova: "Nuova", "stesso-id": "Stessa scheda già presente (stesso identificativo)", "stesso-isbn": "Possibile duplicato: stesso ISBN", "stesso-titolo-autore": "Possibile duplicato: stesso titolo e primo autore", "duplicato-nel-file": "Duplicato dentro il file" }[r];
}

export function planRestore(items: BackupItem[], existing: Book[]): PlanItem[] {
  const byId = new Map(existing.map((b) => [b.id.toLowerCase(), b]));
  const byIsbn = new Map(existing.filter((b) => bare(b.isbn)).map((b) => [bare(b.isbn), b]));
  const byKey = new Map(existing.filter((b) => b.title.trim()).map((b) => [key(b), b]));
  const seenIds = new Set<string>();
  const seenIsbn = new Set<string>();
  const seenKey = new Set<string>();
  return items.map((item) => {
    const isbn = bare(item.input.isbn);
    const k = key(item.input);
    let relation: Relation = "nuova";
    let match: Book | undefined;
    if ((item.id && seenIds.has(item.id)) || (isbn && seenIsbn.has(isbn)) || seenKey.has(k)) relation = "duplicato-nel-file";
    else if (item.id && byId.has(item.id)) { relation = "stesso-id"; match = byId.get(item.id); }
    else if (isbn && byIsbn.has(isbn)) { relation = "stesso-isbn"; match = byIsbn.get(isbn); }
    else if (byKey.has(k)) { relation = "stesso-titolo-autore"; match = byKey.get(k); }
    if (item.id) seenIds.add(item.id);
    if (isbn) seenIsbn.add(isbn);
    seenKey.add(k);
    return { item, relation, ...(match ? { match: { id: match.id, title: match.title } } : {}), resolution: relation === "nuova" ? "crea" : "salta" };
  });
}

export interface RestoreResult {
  created: number;
  updated: number;
  skipped: number;
  failed: { index: number; title: string; message: string }[];
  /** true se il ripristino si è fermato prima della fine (es. sessione scaduta o permessi insufficienti) */
  aborted: boolean;
  /** id della scheda nel file → id della scheda nel catalogo (create, aggiornate o già presenti e corrispondenti). Serve a collegare i prestiti. */
  idMap: Record<string, string>;
}

/** Esegue il piano, una scheda alla volta. Non cancella nulla. Si ferma se la sessione è scaduta o mancano i permessi. */
export async function applyRestore(api: Pick<BooksApi, "createBook" | "updateBook">, plan: PlanItem[], onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const res: RestoreResult = { created: 0, updated: 0, skipped: 0, failed: [], aborted: false, idMap: {} };
  let done = 0;
  for (const p of plan) {
    try {
      if (p.resolution === "salta") { res.skipped++; if (p.item.id && p.match && p.relation !== "duplicato-nel-file") res.idMap[p.item.id] = p.match.id; }
      else if (p.resolution === "aggiorna" && p.match) { await api.updateBook(p.match.id, p.item.input); res.updated++; if (p.item.id) res.idMap[p.item.id] = p.match.id; }
      else { const b = await api.createBook(p.item.input); res.created++; if (p.item.id) res.idMap[p.item.id] = b.id; }
    } catch (e) {
      const kind = (e as { kind?: string }).kind;
      res.failed.push({ index: p.item.index, title: p.item.input.title, message: e instanceof Error ? e.message : "Errore sconosciuto." });
      if (kind === "auth") { res.aborted = true; break; }
    }
    onProgress?.(++done, plan.length);
  }
  return res;
}

export interface LoanRestoreResult {
  created: number;
  /** di cui annullati (ripristinati come annullati, con traccia) */
  voidedCreated: number;
  /** già presenti (stesso destinatario, stessa data di inizio e stessa durata) */
  duplicates: number;
  /** collegati a una scheda non importata/non corrispondente: non ripristinati */
  noBook: number;
  failed: { label: string; message: string }[];
}

const loanKey = (l: { borrower: string | null; loanDate: string; plannedDays: number }, voided = false) => `${voided ? "V" : "A"}|${(l.borrower ?? "").trim().toLowerCase()}|${l.loanDate}|${l.plannedDays}`;

/**
 * Ripristina i prestiti del backup sulle schede corrispondenti (`idMap`). Non cancella e non modifica prestiti esistenti:
 * quelli già presenti si riconoscono e si saltano. Prima i prestiti restituiti (in ordine di data), poi quello attivo.
 * Solo la copia n. 1 è ripristinabile (l'app non gestisce ancora altre copie). L'autore della registrazione diventa chi ripristina.
 */
export async function applyLoanRestore(api: Pick<BooksApi, "createLoan" | "listBookLoans">, loans: BackupLoan[], idMap: Record<string, string>, onProgress?: (done: number, total: number) => void): Promise<LoanRestoreResult> {
  const res: LoanRestoreResult = { created: 0, voidedCreated: 0, duplicates: 0, noBook: 0, failed: [] };
  const existing = new Map<string, Set<string>>();
  const rank = (l: BackupLoan) => (l.voided ? 0 : l.returnedDate !== null ? 1 : 2);
  const ordered = [...loans].sort((a, b) => rank(a) - rank(b) || a.loanDate.localeCompare(b.loanDate));
  let done = 0;
  for (const l of ordered) {
    const label = `«${l.bookTitle || l.bookId}», ${l.borrower}, dal ${l.loanDate}`;
    const target = idMap[l.bookId];
    try {
      if (!target) res.noBook++;
      else if (l.copyNo !== 1) res.failed.push({ label, message: `copia n. ${l.copyNo}: l'app gestisce per ora solo la copia n. 1, il prestito non è stato ripristinato.` });
      else {
        if (!existing.has(target)) existing.set(target, new Set((await api.listBookLoans(target)).loans.map((x) => loanKey(x, x.state === "annullato"))));
        const seen = existing.get(target)!;
        const key = loanKey(l, !!l.voided);
        if (seen.has(key)) res.duplicates++;
        else {
          await api.createLoan(target, { borrower: l.borrower, contact: l.contact, loanDate: l.loanDate, plannedDays: l.plannedDays, notes: l.notes, returnedDate: l.returnedDate, ...(l.voided ? { voidedRestore: { reason: l.voided.reason, originalAt: l.voided.at, originalBy: l.voided.by || "sconosciuto" } } : {}) });
          seen.add(key);
          res.created++;
          if (l.voided) res.voidedCreated++;
        }
      }
    } catch (e) {
      res.failed.push({ label, message: e instanceof Error ? e.message : "Errore sconosciuto." });
      if ((e as { kind?: string }).kind === "auth") break;
    }
    onProgress?.(++done, ordered.length);
  }
  return res;
}

/** Tutti i prestiti (attivi e storico), letti a pagine dall'API riservata all'admin. */
export async function listEveryLoan(api: Pick<BooksApi, "listLoans">): Promise<Loan[]> {
  const out: Loan[] = [];
  for (let page = 1; page < 1000; page++) {
    const r = await api.listLoans({ state: "tutti", page, pageSize: 100 });
    out.push(...r.items);
    if (out.length >= r.total || r.items.length === 0) break;
  }
  return out;
}

/** Cronologia delle correzioni di tutti i prestiti che ne hanno almeno una (una chiamata per prestito corretto, non per libro). */
export async function listEveryCorrection(api: Pick<BooksApi, "listLoanCorrections">, loans: Loan[]): Promise<{ loan: Loan; items: LoanCorrection[] }[]> {
  const out: { loan: Loan; items: LoanCorrection[] }[] = [];
  for (const loan of loans) {
    if (!loan.correctionCount) continue;
    out.push({ loan, items: await api.listLoanCorrections(loan.id) });
  }
  return out;
}
