import type { Loan } from "./api/loans";
import type { Book } from "./api/types";
import { toReadableText } from "./marc/structure";

export const BACKUP_FORMAT = "bibliotheca-backup";
/** Versione 1: solo schede. Versione 2: schede + copie fisiche + prestiti (storico completo, comprese le restituzioni). */
export const BACKUP_VERSION = 2;

/** Un prestito nel backup. Gli stati (in ritardo, durata) non si salvano: si ricalcolano dalle date. `bookId` collega il prestito alla scheda del file. */
export interface BackupLoan {
  bookId: string; bookTitle: string; copyNo: number;
  borrower: string; contact: string; notes: string;
  loanDate: string; plannedDays: number; dueDate: string; returnedDate: string | null;
}
export const toBackupLoan = (l: Loan): BackupLoan => ({
  bookId: l.bookId, bookTitle: l.bookTitle, copyNo: l.copyNo, borrower: l.borrower ?? "", contact: l.contact ?? "", notes: l.notes ?? "",
  loanDate: l.loanDate, plannedDays: l.plannedDays, dueDate: l.dueDate, returnedDate: l.returnedDate,
});

/**
 * Copia completa e fedele. Senza `loans` produce la versione 1 (solo schede); con `loans` (anche vuoto) la versione 2
 * con `copies` e `loans`. Le copie fisiche sono elencate dai prestiti: oggi una copia esiste solo dopo il primo prestito.
 * Non è un file MARC interoperabile.
 */
export function booksToJson(books: Book[], now = new Date(), loans?: Loan[]): string {
  if (!loans) return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), count: books.length, books }, null, 2);
  // I prestiti annullati (registrati per errore) non fanno parte del backup: ne è dichiarato il numero. La traccia delle correzioni resta nel database.
  const all = loans;
  loans = loans.filter((l) => l.state !== "annullato");
  const copies = [...new Map(loans.map((l) => [`${l.bookId}#${l.copyNo}`, { bookId: l.bookId, copyNo: l.copyNo }])).values()];
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), count: books.length, loanCount: loans.length, ...(all.length !== loans.length ? { voidedLoansNotIncluded: all.length - loans.length } : {}), books, copies, loans: loans.map(toBackupLoan) }, null, 2);
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
