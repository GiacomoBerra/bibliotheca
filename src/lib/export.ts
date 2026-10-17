import type { BookCopy, CorrectionAction, Loan, LoanCorrection, LoanCorrectionState } from "./api/loans";
import type { Book } from "./api/types";
import { toReadableText } from "./marc/structure";

export const BACKUP_FORMAT = "bibliotheca-backup";
/**
 * Versione 1: solo schede. Versione 2: schede + copie fisiche + prestiti (storico delle restituzioni compreso).
 * Versione 3: come la 2, più i prestiti ANNULLATI (con motivo e autore).
 * Versione 4: ogni prestito porta con sé la sua CRONOLOGIA COMPLETA di correzioni (autore, data, motivo, stato prima e dopo),
 * l'identificativo originale e chi/quando lo ha registrato: il ripristino ricostruisce stato e tracciabilità senza perdite.
 */
export const BACKUP_VERSION = 4;

/** Una correzione nel backup (dalla più vecchia alla più recente, dentro il suo prestito). */
export interface BackupCorrection { action: CorrectionAction; reason: string; correctedBy: string; correctedAt: string; before: LoanCorrectionState; after: LoanCorrectionState }
/** Un prestito nel backup. Gli stati (in ritardo, durata) non si salvano: si ricalcolano dalle date. `bookId` collega il prestito alla scheda del file. */
export interface BackupLoan {
  /** Identificativo originale del prestito (versione 4). */
  id?: string;
  bookId: string; bookTitle: string; copyNo: number;
  borrower: string; contact: string; notes: string;
  loanDate: string; plannedDays: number; dueDate: string; returnedDate: string | null;
  /** Chi/quando ha registrato il prestito e chi la restituzione (versione 4). */
  createdBy?: string; createdAt?: string; returnedBy?: string;
  /** Presente solo se il prestito è stato annullato perché registrato per errore. */
  voided?: { at: string; by: string; reason: string };
  /** Cronologia completa delle correzioni (versione 4), dalla più vecchia. */
  corrections?: BackupCorrection[];
}
/** `corrections` arriva dall'API dalla più recente alla più vecchia: nel backup si salva in ordine cronologico. */
export const toBackupLoan = (l: Loan, corrections: LoanCorrection[] = []): BackupLoan => ({
  id: l.id, bookId: l.bookId, bookTitle: l.bookTitle, copyNo: l.copyNo, borrower: l.borrower ?? "", contact: l.contact ?? "", notes: l.notes ?? "",
  loanDate: l.loanDate, plannedDays: l.plannedDays, dueDate: l.dueDate, returnedDate: l.returnedDate,
  ...(l.createdBy ? { createdBy: l.createdBy } : {}), ...(l.createdAt ? { createdAt: l.createdAt } : {}), ...(l.returnedBy ? { returnedBy: l.returnedBy } : {}),
  ...(l.voidedAt ? { voided: { at: l.voidedAt, by: l.voidedBy ?? "", reason: l.voidReason ?? "" } } : {}),
  corrections: [...corrections].reverse().map((c) => ({ action: c.action, reason: c.reason, correctedBy: c.correctedBy, correctedAt: c.correctedAt, before: c.before, after: c.after })),
});

/**
 * Copia completa e fedele. Senza `loans` produce la versione 1 (solo schede); con `loans` (anche vuoto) la versione 4
 * con `copies` e, per ogni prestito (annullati compresi), la sua cronologia di correzioni. Le copie fisiche sono
 * elencate dai prestiti: oggi una copia esiste solo dopo il primo prestito. Non è un file MARC interoperabile.
 */
export function booksToJson(books: Book[], now = new Date(), loans?: Loan[], corrections: { loan: Loan; items: LoanCorrection[] }[] = [], allCopies?: BookCopy[]): string {
  if (!loans) return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), count: books.length, books }, null, 2);
  // Copie: quelle del database (con codice e note) se fornite; altrimenti solo quelle che hanno prestiti.
  const fromDb = (allCopies ?? []).filter((c) => c.id !== null).map((c) => ({ bookId: c.bookId, copyNo: c.copyNo, inventoryCode: c.inventoryCode, notes: c.notes }));
  const copies = allCopies ? fromDb : [...new Map(loans.map((l) => [`${l.bookId}#${l.copyNo}`, { bookId: l.bookId, copyNo: l.copyNo }])).values()];
  const byLoan = new Map(corrections.map((c) => [c.loan.id, c.items]));
  const out = loans.map((l) => toBackupLoan(l, byLoan.get(l.id) ?? []));
  return JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), count: books.length,
    copyCount: copies.length, loanCount: out.length, voidedLoanCount: out.filter((l) => l.voided).length, correctionCount: out.reduce((n, l) => n + (l.corrections?.length ?? 0), 0),
    books, copies, loans: out,
  }, null, 2);
}

/** Neutralizza le "formule" (=, +, -, @, tab, CR) quando il CSV viene aperto in un foglio di calcolo. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CSV_COLUMNS: [string, (b: Book) => string][] = [
  ["titolo", (b) => b.title],
  ["autori", (b) => b.authors.join(" | ")],
  ["isbn", (b) => b.isbn],
  ["editore", (b) => b.publisher],
  ["luogo", (b) => b.publicationPlace],
  ["anno", (b) => b.publicationYear],
  ["lingua", (b) => b.language],
  ["descrizione_fisica", (b) => b.physicalDescription],
  ["soggetti", (b) => b.subjects.join(" | ")],
  ["dewey", (b) => b.dewey],
  ["dewey_fonte", (b) => b.deweySource],
  ["dewey_note", (b) => b.deweyNotes],
  ["collocazione", (b) => b.shelfMark],
  ["note", (b) => b.notes],
  ["stato", (b) => b.status],
];

/** CSV con BOM UTF-8 (per Excel) e righe CRLF. Il CSV non contiene i dati MARC completi. */
export function booksToCsv(books: Book[]): string {
  const head = CSV_COLUMNS.map(([h]) => h).join(",");
  const rows = books.map((b) => CSV_COLUMNS.map(([, f]) => csvCell(f(b))).join(","));
  return "﻿" + [head, ...rows].join("\r\n") + "\r\n";
}

/**
 * Elenco testuale dei record MARC21 delle schede che ne hanno uno (rappresentazione leggibile «=245  10$a…»).
 * NON è ISO 2709 né MARCXML e non è importabile in altri sistemi come file MARC.
 */
export function booksToMarcText(books: Book[]): { text: string; count: number } {
  const withMarc = books.filter((b) => b.marcFields && b.marcFields.length > 0);
  const text = withMarc.map((b) => `# ${b.title} [${b.id}]\n${toReadableText(b.marcLeader, b.marcFields)}`).join("\n\n") + (withMarc.length ? "\n" : "");
  return { text, count: withMarc.length };
}

export function downloadText(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
