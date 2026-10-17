import { parseBookInput } from "./api/parse";
import type { Book, BookInput, BooksApi } from "./api/types";
import { addDays, isIsoDate, parseRestoreInput, type Loan, type LoanCorrection, type LoanCorrectionState, type LoanRestoreRecord, type RestoreCopy, type RestoreCorrection } from "./api/loans";
import { BACKUP_FORMAT, toBackupLoan, type BackupLoan } from "./export";

/**
 * Ripristino da un backup JSON creato da Bibliotheca. Principi:
 * - il file non è fidato: ogni scheda passa dalla STESSA validazione del server (`parseBookInput`);
 * - il ripristino NON cancella mai nulla: crea schede nuove o, solo se l'utente lo sceglie, aggiorna quelle esistenti;
 * - i conflitti si mostrano prima e si risolvono uno per uno;
 * - le scritture avvengono con le API normali (che verificano il ruolo admin lato server).
 */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_VERSIONS = [1, 2, 3, 4];

export interface RecordIssue { index: number; title: string; errors: string[] }
export interface BackupItem { index: number; id?: string; input: BookInput; /** Cose da controllare (non bloccanti). */ notes?: string[] }
export type ParsedBackup =
  | { ok: false; message: string }
  | { ok: true; exportedAt?: string; declaredCount: number | null; items: BackupItem[]; issues: RecordIssue[]; warnings: string[]; version?: number; loans?: BackupLoan[]; loanIssues?: string[]; copies?: RestoreCopy[] };

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
  if (o["version"] >= 2) {
    const { loans, issues: loanIssues } = parseBackupLoans(o["loans"], o["version"] as number);
    out.loans = loans;
    out.loanIssues = loanIssues;
    const declaredLoans = typeof o["loanCount"] === "number" ? o["loanCount"] : null;
    if (declaredLoans !== null && Array.isArray(o["loans"]) && declaredLoans !== o["loans"].length) warnings.push(`Il file dichiara ${declaredLoans} prestiti ma ne contiene ${o["loans"].length}: potrebbe essere incompleto.`);
    const declaredCorr = typeof o["correctionCount"] === "number" ? o["correctionCount"] : null;
    const gotCorr = loans.reduce((n, l) => n + (l.corrections?.length ?? 0), 0);
    if (o["version"] === 4 && declaredCorr !== null && declaredCorr !== gotCorr && loanIssues.length === 0) warnings.push(`Il file dichiara ${declaredCorr} correzioni ma ne contiene ${gotCorr}: potrebbe essere incompleto.`);
  }
  if (o["version"] >= 2 && Array.isArray(o["copies"])) {
    const copies: RestoreCopy[] = [];
    for (const c of o["copies"] as Record<string, unknown>[]) {
      if (c && typeof c["bookId"] === "string" && typeof c["copyNo"] === "number" && Number.isInteger(c["copyNo"]) && c["copyNo"] >= 1) {
        const code = typeof c["inventoryCode"] === "string" && c["inventoryCode"].trim() ? c["inventoryCode"].trim() : null;
        copies.push({ bookId: c["bookId"], copyNo: c["copyNo"], inventoryCode: code, notes: typeof c["notes"] === "string" && c["notes"] ? c["notes"] : null });
      }
    }
    out.copies = copies;
    if (o["version"] === 4 && typeof o["copyCount"] === "number" && o["copyCount"] !== copies.length) warnings.push(`Il file dichiara ${o["copyCount"]} copie ma ne contiene ${copies.length}: potrebbe essere incompleto.`);
  }
  if (o["version"] === 2) warnings.push("Backup di versione 2: i prestiti annullati per errore e la cronologia delle correzioni non sono nel file.");
  if (o["version"] === 3) warnings.push("Backup di versione 3: contiene i prestiti annullati ma non la cronologia completa delle correzioni (es. restituzioni annullate); chi ha registrato i prestiti non è nel file.");
  return out;
}

/** Registra l'avanzo di un annullamento di prestito dei vecchi backup (v3) come correzione, usando autore, data e motivo veri del file. */
function legacyVoidCorrection(l: BackupLoan, voided: NonNullable<BackupLoan["voided"]>): RestoreCorrection {
  const by = voided.by || "sconosciuto";
  return {
    action: "annulla_prestito", reason: voided.reason, correctedBy: by, correctedAt: voided.at,
    before: { state: l.returnedDate ? "restituito" : "attivo", returnedDate: l.returnedDate, returnedBy: null, voided: false },
    after: { state: "annullato", returnedDate: l.returnedDate, returnedBy: null, voided: true },
  };
}
/** Trasforma un prestito del backup nel record da ripristinare sulla scheda `bookId` del database di destinazione. */
export function toRestoreRecord(l: BackupLoan, bookId: string): LoanRestoreRecord {
  const voided = l.voided ? { ...l.voided, by: l.voided.by || "sconosciuto" } : undefined;
  // File v4: la cronologia è quella dichiarata (anche vuota). File v2/v3 (nessun campo «corrections»): per un annullato si ricostruisce l'unica correzione nota.
  const corrections: RestoreCorrection[] = l.corrections !== undefined ? l.corrections : voided ? [legacyVoidCorrection(l, voided)] : [];
  // L'autore della restituzione del file è dichiarato negli stati delle correzioni, non qui: se manca subentra chi ripristina.
  return {
    ...(l.id ? { id: l.id } : {}), bookId, copyNo: l.copyNo, borrower: l.borrower, contact: l.contact, notes: l.notes,
    loanDate: l.loanDate, plannedDays: l.plannedDays, returnedDate: l.returnedDate,
    ...(l.createdBy ? { createdBy: l.createdBy } : {}), ...(l.createdAt ? { createdAt: l.createdAt } : {}), ...(l.returnedBy ? { returnedBy: l.returnedBy } : {}),
    ...(voided ? { voided } : {}), corrections,
  };
}

const PLACEHOLDER_BOOK = "00000000-0000-4000-8000-000000000000";

/**
 * Legge i prestiti di un backup e li valida con la STESSA funzione che userà il server (`parseRestoreInput`), compresa la
 * coerenza della cronologia delle correzioni. Un errore su un prestito è riportato qui, PRIMA di scrivere qualsiasi cosa.
 */
function parseBackupLoans(raw: unknown, version: number): { loans: BackupLoan[]; issues: string[] } {
  if (!Array.isArray(raw)) return { loans: [], issues: ["Backup senza l'elenco «loans»."] };
  const loans: BackupLoan[] = [];
  const issues: string[] = [];
  raw.forEach((x, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const title = typeof o["bookTitle"] === "string" ? ` («${o["bookTitle"]}»)` : "";
    if (typeof o["bookId"] !== "string" || !o["bookId"]) { issues.push(`Prestito ${i + 1}${title}: manca il collegamento al libro.`); return; }
    const l: BackupLoan = {
      ...(typeof o["id"] === "string" && version >= 4 ? { id: o["id"] } : {}),
      bookId: o["bookId"], bookTitle: typeof o["bookTitle"] === "string" ? o["bookTitle"] : "", copyNo: o["copyNo"] as number,
      borrower: o["borrower"] as string, contact: (o["contact"] ?? "") as string, notes: (o["notes"] ?? "") as string,
      loanDate: o["loanDate"] as string, plannedDays: o["plannedDays"] as number, dueDate: typeof o["dueDate"] === "string" ? o["dueDate"] : "",
      returnedDate: (o["returnedDate"] ?? null) as string | null,
      ...(typeof o["createdBy"] === "string" && version >= 4 ? { createdBy: o["createdBy"] } : {}), ...(typeof o["createdAt"] === "string" && version >= 4 ? { createdAt: o["createdAt"] } : {}),
      ...(typeof o["returnedBy"] === "string" && version >= 4 ? { returnedBy: o["returnedBy"] } : {}),
      ...(o["voided"] != null && version >= 3 ? { voided: o["voided"] as NonNullable<BackupLoan["voided"]> } : {}),
      ...(version >= 4 ? { corrections: (Array.isArray(o["corrections"]) ? o["corrections"] : []) as NonNullable<BackupLoan["corrections"]> } : {}),
    };
    // Validazione completa con le regole del server (la scheda è un segnaposto: qui si controllano i dati, non il collegamento).
    const check = parseRestoreInput({ loans: [toRestoreRecord({ ...l, bookId: PLACEHOLDER_BOOK }, PLACEHOLDER_BOOK)] });
    if (!check.ok) { issues.push(`Prestito ${i + 1}${title}: ${check.message.replace(/^Prestito 1: /, "")}`); return; }
    const rec = check.value[0]!;
    loans.push({ ...l, borrower: rec.borrower, contact: rec.contact, notes: rec.notes, dueDate: addDays(rec.loanDate, rec.plannedDays) });
  });
  // Due prestiti attivi sulla stessa copia (stesso libro) nel file: incoerente.
  const active = new Map<string, number>();
  loans.forEach((l) => { if (l.returnedDate === null && !l.voided) { const k = `${l.bookId}#${l.copyNo}`; active.set(k, (active.get(k) ?? 0) + 1); } });
  for (const [k, n] of active) if (n > 1) issues.push(`Il libro ${k.split("#")[0]} ha ${n} prestiti attivi sulla copia n. ${k.split("#")[1]}: incoerente.`);
  return { loans, issues };
}

export type Resolution = "crea" | "aggiorna" | "salta";
/** Schede già presenti che sembrano la stessa di `input` (stesso ISBN, oppure stesso titolo e primo autore). Serve all'inserimento manuale. */
export function findProbableDuplicates(input: BookInput, candidates: Book[]): { book: Book; why: "ISBN" | "titolo e primo autore" }[] {
  const isbn = bare(input.isbn);
  const out: { book: Book; why: "ISBN" | "titolo e primo autore" }[] = [];
  for (const b of candidates) {
    if (isbn && bare(b.isbn) === isbn) out.push({ book: b, why: "ISBN" });
    else if (input.title.trim() && key(b) === key(input)) out.push({ book: b, why: "titolo e primo autore" });
  }
  return out;
}

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

export interface LoanPlanProblem { label: string; reason: string }
export interface LoanRestorePlan {
  /** Da scrivere, in un colpo solo. */
  toCreate: LoanRestoreRecord[];
  /** già presenti e identici (stesso identificativo e stessa storia): saltati senza rischio. */
  same: number;
  /** probabili duplicati senza lo stesso identificativo (stesso destinatario, data e durata): saltati. */
  probableDuplicates: LoanPlanProblem[];
  /** stesso identificativo ma dati o storia DIVERSI nel database: NON sovrascritti, da esaminare. */
  differing: LoanPlanProblem[];
  /** copia già in prestito a un altro destinatario nel database: non ripristinabile finché non viene restituita. */
  blocked: LoanPlanProblem[];
  /** collegati a una scheda non importata/non corrispondente */
  noBook: number;
  /** Copie del file (anche senza prestiti) sulle schede di destinazione: il server crea quelle mancanti e non sovrascrive mai codice o note già presenti. */
  copies: RestoreCopy[];
}
export interface LoanRestoreResult {
  created: number;
  /** di cui annullati */
  voidedCreated: number;
  /** correzioni di cronologia scritte */
  corrections: number;
  /** copie fisiche create */
  copiesCreated: number;
  duplicates: number;
  noBook: number;
  differing: number;
  blocked: number;
  failed: { label: string; message: string }[];
}

const loanKey = (l: { borrower: string | null; loanDate: string; plannedDays: number; copyNo?: number }, voided = false) => `${voided ? "V" : "A"}|${l.copyNo ?? 1}|${(l.borrower ?? "").trim().toLowerCase()}|${l.loanDate}|${l.plannedDays}`;
const labelOf = (l: BackupLoan) => `«${l.bookTitle || l.bookId}», ${l.borrower}, dal ${l.loanDate}`;

/** Forma canonica (senza identificativi di scheda) per confrontare due versioni dello stesso prestito. `legacy`: il file non porta autori né cronologia. */
function canonical(l: BackupLoan, legacy: boolean): string {
  const base: unknown[] = [l.copyNo, l.borrower.trim(), (l.contact ?? "").trim(), (l.notes ?? "").trim(), l.loanDate, l.plannedDays, l.returnedDate, l.voided ? [l.voided.at, l.voided.by || "sconosciuto", l.voided.reason] : null];
  if (!legacy) base.push(l.createdBy ?? null, l.createdAt ?? null, l.returnedBy ?? null, (l.corrections ?? []).map((c) => [c.action, c.reason, c.correctedBy, c.correctedAt, c.before, c.after]));
  return JSON.stringify(base);
}
const isLegacy = (l: BackupLoan) => l.corrections === undefined;

/** Prestito del database nella stessa forma del backup (con la sua cronologia, se ne ha). */
async function dbAsBackup(api: Pick<BooksApi, "listLoanCorrections">, l: Loan): Promise<BackupLoan> {
  return toBackupLoan(l, l.correctionCount > 0 ? await api.listLoanCorrections(l.id) : []);
}

/**
 * PRIMA di scrivere qualsiasi cosa: confronta ogni prestito del file con quelli già presenti e decide cosa fare.
 * Nulla viene mai sovrascritto o cancellato. Ritorna anche ciò che NON si può ripristinare, con il motivo.
 */
export async function planLoanRestore(api: Pick<BooksApi, "listBookLoans" | "listLoanCorrections">, loans: BackupLoan[], idMap: Record<string, string>, fileCopies: RestoreCopy[] = []): Promise<LoanRestorePlan> {
  const plan: LoanRestorePlan = { toCreate: [], same: 0, probableDuplicates: [], differing: [], blocked: [], noBook: 0, copies: fileCopies.filter((c) => idMap[c.bookId]).map((c) => ({ ...c, bookId: idMap[c.bookId]! })) };
  const existing = new Map<string, Loan[]>();
  for (const l of loans) {
    const target = idMap[l.bookId];
    if (!target) { plan.noBook++; continue; }
    if (!existing.has(target)) existing.set(target, (await api.listBookLoans(target)).loans);
    const here = existing.get(target)!;
    const sameId = l.id ? here.find((x) => x.id === l.id) : undefined;
    if (sameId) {
      const same = canonical(await dbAsBackup(api, sameId), isLegacy(l)) === canonical(l, isLegacy(l));
      if (same) plan.same++; else plan.differing.push({ label: labelOf(l), reason: "esiste già un prestito con lo stesso identificativo ma con dati o cronologia diversi: non è stato sovrascritto." });
      continue;
    }
    const k = loanKey(l, !!l.voided);
    if (here.some((x) => loanKey(x, x.state === "annullato") === k)) { plan.probableDuplicates.push({ label: labelOf(l), reason: "esiste già un prestito con stesso destinatario, data e durata (identificativo diverso): saltato come probabile duplicato." }); continue; }
    if (l.returnedDate === null && !l.voided && here.some((x) => x.copyNo === l.copyNo && x.state !== "restituito" && x.state !== "annullato")) {
      plan.blocked.push({ label: labelOf(l), reason: `la copia n. ${l.copyNo} risulta già in prestito a un altro destinatario: non è ripristinabile finché non viene restituita.` });
      continue;
    }
    plan.toCreate.push(toRestoreRecord(l, target));
    // Il libro, per i controlli successivi, ha già questo prestito (evita doppi attivi nello stesso file).
    here.push({ id: l.id ?? "nuovo", copyNo: l.copyNo, borrower: l.borrower, loanDate: l.loanDate, plannedDays: l.plannedDays, state: l.voided ? "annullato" : l.returnedDate ? "restituito" : "in prestito" } as Loan);
  }
  return plan;
}

/**
 * Scrive il piano con UNA sola richiesta al server (una sola istruzione SQL): o entrano tutti i prestiti con la loro
 * cronologia o non cambia nulla. Se la richiesta fallisce, il database dei prestiti è esattamente com'era.
 */
export async function applyLoanRestore(api: Pick<BooksApi, "restoreLoans">, plan: LoanRestorePlan): Promise<LoanRestoreResult> {
  const res: LoanRestoreResult = { created: 0, voidedCreated: 0, corrections: 0, copiesCreated: 0, duplicates: plan.same + plan.probableDuplicates.length, noBook: plan.noBook, differing: plan.differing.length, blocked: plan.blocked.length, failed: [] };
  if (plan.toCreate.length === 0 && plan.copies.length === 0) return res;
  try {
    const r = await api.restoreLoans(plan.toCreate, plan.copies);
    res.copiesCreated = r.copiesCreated;
    res.created = r.created;
    res.corrections = r.corrections;
    res.voidedCreated = r.created === plan.toCreate.length ? plan.toCreate.filter((x) => x.voided).length : 0;
    res.duplicates += r.skipped;
  } catch (e) {
    res.failed.push({ label: `${plan.toCreate.length} prestiti e ${plan.copies.length} copie`, message: `${e instanceof Error ? e.message : "Errore sconosciuto."} Nessun prestito è stato scritto.` });
  }
  return res;
}

export interface RestoreCheck { checked: number; /** copie fisiche confrontate */ copiesChecked: number; mismatches: string[] }
/**
 * Verifica FINALE sul database reale: rilegge prestiti e correzioni e controlla che ogni prestito del file sia presente
 * con gli stessi dati e la stessa cronologia (per i file v4: identificativo, autori, date, motivi, stati prima/dopo).
 * Esclude, per costruzione, ciò che il piano ha saltato e dichiarato (differenze, blocchi, schede mancanti).
 */
export async function verifyLoanRestore(api: Pick<BooksApi, "listLoans" | "listLoanCorrections"> & Partial<Pick<BooksApi, "listAllCopies">>, loans: BackupLoan[], idMap: Record<string, string>, skipped: Set<string> = new Set(), fileCopies: RestoreCopy[] = []): Promise<RestoreCheck> {
  const all = await listEveryLoan(api);
  const mismatches: string[] = [];
  let checked = 0; let copiesChecked = 0;
  for (const l of loans) {
    const target = idMap[l.bookId];
    if (!target || skipped.has(labelOf(l))) continue;
    checked++;
    const mine = all.filter((x) => x.bookId === target);
    const found = (l.id ? mine.find((x) => x.id === l.id) : undefined) ?? mine.find((x) => loanKey(x, x.state === "annullato") === loanKey(l, !!l.voided));
    if (!found) { mismatches.push(`${labelOf(l)}: non è presente nel database.`); continue; }
    if (canonical(await dbAsBackup(api, found), isLegacy(l)) !== canonical(l, isLegacy(l))) mismatches.push(`${labelOf(l)}: dati o cronologia diversi dal file.`);
  }
  if (api.listAllCopies && fileCopies.length) {
    const dbCopies = await api.listAllCopies();
    for (const c of fileCopies) {
      const target = idMap[c.bookId];
      if (!target) continue;
      copiesChecked++;
      const found = dbCopies.find((x) => x.bookId === target && x.copyNo === c.copyNo);
      if (!found) mismatches.push(`Copia n. ${c.copyNo} di una scheda: non è presente nel database.`);
      else if (c.inventoryCode && found.inventoryCode?.toLowerCase() !== c.inventoryCode.toLowerCase()) mismatches.push(`Copia n. ${c.copyNo}: codice di inventario diverso dal file («${c.inventoryCode}» nel file, «${found.inventoryCode ?? "nessuno"}» nel database).`);
    }
  }
  return { checked, copiesChecked, mismatches };
}

/**
 * Impronta della storia dei prestiti di un backup, indipendente dagli identificativi delle schede (che cambiano quando
 * si ripristina in un altro database): serve a dimostrare che due backup conservano gli stessi prestiti e le stesse correzioni.
 */
export function loanHistoryDigest(loans: BackupLoan[], bookKey: (bookId: string) => string): string[] {
  return loans.map((l) => JSON.stringify([bookKey(l.bookId), l.id ?? null, canonical(l, false)])).sort();
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
