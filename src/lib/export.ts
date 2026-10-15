import type { Book } from "./api/types";

export const BACKUP_FORMAT = "bibliotheca-backup";
export const BACKUP_VERSION = 1;

/** Copia completa e fedele delle schede. Non è un file MARC interoperabile. */
export function booksToJson(books: Book[], now = new Date()): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), count: books.length, books }, null, 2);
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
